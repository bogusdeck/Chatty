require("dotenv").config();

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { Server } = require("socket.io");
const selfsigned = require("selfsigned");

const config = require("./config");
const logger = require("./logger");
const RoomStore = require("./rooms");
const { globalLimiter, authLimiter } = require("./rateLimit");
const { authMiddleware, authenticateCredentials, issueToken, verifyToken } = require("./auth");

const app = express();
const rooms = new RoomStore();
const socketEventState = new Map();

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "wss:", "https:"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        mediaSrc: ["'self'", "blob:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(express.json({ limit: "16kb" }));
app.use(globalLimiter);
app.use(express.static(config.publicDir, { extensions: ["html"] }));

app.get("/api/config", authMiddleware, (req, res) => {
  res.json({
    username: req.user.username,
    iceServers: config.iceServers
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  if (!authenticateCredentials(username, password)) {
    logger.info("auth_failed", { username });
    return res.status(401).json({ error: "Invalid credentials." });
  }

  logger.info("auth_success", { username });
  return res.json({ token: issueToken(username) });
});

app.get("/api/session", authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found." });
  }

  return res.sendFile(path.join(config.publicDir, "index.html"));
});

function createServer() {
  // When running behind a reverse proxy (Render, Railway, etc.) that
  // handles TLS termination, run plain HTTP internally.
  if (config.trustProxy) {
    return http.createServer(app);
  }

  // Standalone production: needs real cert files.
  if (config.isProduction) {
    if (!config.tlsKeyPath || !config.tlsCertPath) {
      throw new Error("TLS_KEY_PATH and TLS_CERT_PATH are required in production without a proxy.");
    }

    return https.createServer(
      {
        key: fs.readFileSync(config.tlsKeyPath),
        cert: fs.readFileSync(config.tlsCertPath)
      },
      app
    );
  }

  // Local development: self-signed cert so getUserMedia works on localhost.
  const attrs = [{ name: "commonName", value: "localhost" }];
  const cert = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 30,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }]
      }
    ]
  });

  return https.createServer(
    {
      key: cert.private,
      cert: cert.cert
    },
    app
  );
}

function rateLimitSocket(socket, eventName) {
  const key = `${socket.id}:${eventName}`;
  const now = Date.now();
  const state = socketEventState.get(key) || { count: 0, windowStart: now };

  if (now - state.windowStart > 5000) {
    state.count = 0;
    state.windowStart = now;
  }

  state.count += 1;
  socketEventState.set(key, state);

  return state.count <= 25;
}

const server = createServer();

const io = new Server(server, {
  cors: {
    origin: false
  },
  transports: ["websocket"]
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const payload = verifyToken(token);
    socket.data.username = payload.sub;
    return next();
  } catch (error) {
    return next(new Error("Authentication failed."));
  }
});

io.on("connection", (socket) => {
  logger.info("socket_connected", { username: socket.data.username, socketId: socket.id });

  socket.on("room:join", ({ roomId }) => {
    if (!rateLimitSocket(socket, "room:join")) {
      return socket.emit("room:error", { message: "Rate limit exceeded." });
    }

    if (!roomId || typeof roomId !== "string" || roomId.length > 64) {
      return socket.emit("room:error", { message: "Invalid room ID." });
    }

    const result = rooms.join(roomId, socket.id, socket.data.username);
    if (!result.ok) {
      return socket.emit("room:error", { message: result.reason });
    }

    socket.data.roomId = roomId;
    socket.join(roomId);

    logger.info("room_join", { roomId, username: socket.data.username, isHost: result.isHost });
    socket.emit("room:joined", {
      roomId,
      isHost: result.isHost,
      participants: result.participants
    });
    socket.to(roomId).emit("room:peer-joined", {
      participants: result.participants
    });
  });

  socket.on("signal", ({ roomId, type, payload, targetSocketId }) => {
    if (!rateLimitSocket(socket, "signal")) {
      return socket.emit("room:error", { message: "Rate limit exceeded." });
    }

    if (!socket.data.roomId || socket.data.roomId !== roomId) {
      return socket.emit("room:error", { message: "Not joined to this room." });
    }

    if (!["offer", "answer", "candidate"].includes(type)) {
      return socket.emit("room:error", { message: "Invalid signal type." });
    }

    if (targetSocketId) {
      io.to(targetSocketId).emit("signal", {
        fromSocketId: socket.id,
        fromUsername: socket.data.username,
        type,
        payload
      });
      return;
    }

    socket.to(roomId).emit("signal", {
      fromSocketId: socket.id,
      fromUsername: socket.data.username,
      type,
      payload
    });
  });

  socket.on("room:end", ({ roomId }) => {
    if (!rateLimitSocket(socket, "room:end")) {
      return socket.emit("room:error", { message: "Rate limit exceeded." });
    }

    const participants = rooms.list(roomId);

    if (!participants.some((p) => p.socketId === socket.id)) {
      return socket.emit("room:error", { message: "You are not in this room." });
    }

    logger.info("room_end", { roomId, username: socket.data.username });

    // Broadcast first, then clean up on next tick so room:ended
    // is guaranteed to reach all members before they leave the room.
    io.to(roomId).emit("room:ended", { roomId });

    setImmediate(() => {
      for (const participant of participants) {
        const participantSocket = io.sockets.sockets.get(participant.socketId);
        if (participantSocket) {
          participantSocket.leave(roomId);
          delete participantSocket.data.roomId;
          rooms.leave(roomId, participant.socketId);
        }
      }
    });
  });

  socket.on("room:leave", ({ roomId }) => {
    if (!rateLimitSocket(socket, "room:leave")) {
      return socket.emit("room:error", { message: "Rate limit exceeded." });
    }

    handleLeave(socket, roomId, false);
  });

  socket.on("disconnect", (reason) => {
    handleLeave(socket, socket.data.roomId, true, reason);
    logger.info("socket_disconnected", {
      username: socket.data.username,
      socketId: socket.id,
      reason
    });
  });
});

function handleLeave(socket, roomId, isDisconnect, disconnectReason) {
  if (!roomId) {
    return;
  }

  const leaveResult = rooms.leave(roomId, socket.id);
  delete socket.data.roomId;

  if (!leaveResult) {
    return;
  }

  logger.info("room_leave", {
    roomId,
    username: socket.data.username,
    isDisconnect,
    reason: disconnectReason
  });

  if (!isDisconnect) {
    socket.leave(roomId);
  }

  if (leaveResult.wasHost) {
    io.to(roomId).emit("room:ended", { roomId });

    for (const participant of leaveResult.remainingParticipants) {
      const participantSocket = io.sockets.sockets.get(participant.socketId);
      if (participantSocket) {
        participantSocket.leave(roomId);
        delete participantSocket.data.roomId;
        rooms.leave(roomId, participant.socketId);
      }
    }

    return;
  }

  socket.to(roomId).emit("room:peer-left", {
    socketId: socket.id,
    username: socket.data.username
  });
}

server.listen(config.port, () => {
  logger.info("server_started", {
    env: config.env,
    port: config.port,
    proxy: config.trustProxy
  });
});
