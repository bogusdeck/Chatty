const state = {
  token: localStorage.getItem("video-app-token") || "",
  username: "",
  roomId: "",
  isHost: false,
  socket: null,
  localStream: null,
  peerConnection: null,
  remoteSocketId: null,
  iceServers: [],
  micEnabled: true,
  cameraEnabled: true
};

const authPanel = document.getElementById("auth-panel");
const callPanel = document.getElementById("call-panel");
const loginForm = document.getElementById("login-form");
const authError = document.getElementById("auth-error");
const callError = document.getElementById("call-error");
const joinForm = document.getElementById("join-form");
const leaveBtn = document.getElementById("leave-btn");
const muteBtn = document.getElementById("mute-btn");
const cameraBtn = document.getElementById("camera-btn");
const endSessionBtn = document.getElementById("end-session-btn");
const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const welcomeText = document.getElementById("welcome-text");
const roomSummary = document.getElementById("room-summary");
const connectionStatus = document.getElementById("connection-status");

loginForm.addEventListener("submit", handleLogin);
joinForm.addEventListener("submit", handleJoin);
leaveBtn.addEventListener("click", leaveRoom);
muteBtn.addEventListener("click", toggleMute);
cameraBtn.addEventListener("click", toggleCamera);
endSessionBtn.addEventListener("click", endSession);

bootstrap();

async function bootstrap() {
  if (!state.token) {
    showLoggedOut();
    return;
  }

  try {
    const session = await fetchJson("/api/session", {
      headers: authHeaders()
    });

    state.username = session.username;
    const config = await fetchJson("/api/config", {
      headers: authHeaders()
    });

    state.iceServers = config.iceServers;
    showLoggedIn();
  } catch (error) {
    localStorage.removeItem("video-app-token");
    state.token = "";
    showLoggedOut();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  authError.textContent = "";

  const form = new FormData(loginForm);
  const username = form.get("username");
  const password = form.get("password");

  try {
    const response = await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    state.token = response.token;
    localStorage.setItem("video-app-token", state.token);
    state.username = username;

    const config = await fetchJson("/api/config", {
      headers: authHeaders()
    });

    state.iceServers = config.iceServers;
    showLoggedIn();
  } catch (error) {
    authError.textContent = error.message;
  }
}

async function handleJoin(event) {
  event.preventDefault();
  callError.textContent = "";

  const roomId = new FormData(joinForm).get("roomId").trim();
  if (!roomId) {
    callError.textContent = "Room ID is required.";
    return;
  }

  try {
    await ensureLocalMedia();
    if (!state.socket) {
      connectSocket();
    }

    state.roomId = roomId;
    state.socket.emit("room:join", { roomId });
    setConnectionStatus("Joining...");
  } catch (error) {
    callError.textContent = error.message;
  }
}

function connectSocket() {
  state.socket = io({
    auth: {
      token: state.token
    },
    transports: ["websocket"],
    secure: true
  });

  state.socket.on("connect", () => {
    setConnectionStatus("Authenticated");
  });

  state.socket.on("connect_error", (error) => {
    callError.textContent = error.message || "Socket connection failed.";
    setConnectionStatus("Connection error");
  });

  state.socket.on("room:error", ({ message }) => {
    callError.textContent = message;
    setConnectionStatus("Room error");
  });

  state.socket.on("room:joined", async ({ roomId, isHost, participants }) => {
    state.isHost = isHost;
    state.roomId = roomId;
    updateControls();
    updateRoomSummary(participants);
    setConnectionStatus(participants.length === 2 ? "Connected" : "Waiting for peer");

    if (!isHost) {
      state.remoteSocketId = participants.find((participant) => participant.socketId !== state.socket.id)?.socketId || null;
      await createPeerConnection();
      await makeOffer();
    }
  });

  state.socket.on("room:peer-joined", async ({ participants }) => {
    updateRoomSummary(participants);
    state.remoteSocketId = participants.find((participant) => participant.socketId !== state.socket.id)?.socketId || null;
    setConnectionStatus("Peer joined");

    if (state.isHost) {
      await createPeerConnection();
    }
  });

  state.socket.on("signal", async ({ fromSocketId, type, payload }) => {
    state.remoteSocketId = fromSocketId;

    try {
      if (!state.peerConnection) {
        await createPeerConnection();
      }

      if (type === "offer") {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await state.peerConnection.createAnswer();
        await state.peerConnection.setLocalDescription(answer);
        state.socket.emit("signal", {
          roomId: state.roomId,
          targetSocketId: fromSocketId,
          type: "answer",
          payload: answer
        });
        setConnectionStatus("Answer sent");
      } else if (type === "answer") {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
        setConnectionStatus("Connected");
      } else if (type === "candidate" && payload) {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(payload));
      }
    } catch (error) {
      callError.textContent = `Signaling failed: ${error.message}`;
    }
  });

  state.socket.on("room:peer-left", () => {
    setConnectionStatus("Peer left");
    roomSummary.textContent = "Peer left the room.";
    closePeerConnection();
  });

  state.socket.on("room:ended", () => {
    // Fires for BOTH participants — tear down and redirect
    closePeerConnection();
    stopLocalMedia();
    state.roomId = "";
    state.isHost = false;
    state.remoteSocketId = null;
    updateControls();
    window.location.href = "https://www.bugcrowd.com";
  });
}

async function ensureLocalMedia() {
  if (state.localStream) {
    return;
  }

  state.localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  });
  localVideo.srcObject = state.localStream;
}

async function createPeerConnection() {
  if (state.peerConnection) {
    return;
  }

  state.peerConnection = new RTCPeerConnection({
    iceServers: state.iceServers
  });

  for (const track of state.localStream.getTracks()) {
    state.peerConnection.addTrack(track, state.localStream);
  }

  state.peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  state.peerConnection.onicecandidate = (event) => {
    if (event.candidate && state.socket && state.roomId) {
      state.socket.emit("signal", {
        roomId: state.roomId,
        targetSocketId: state.remoteSocketId,
        type: "candidate",
        payload: event.candidate
      });
    }
  };

  state.peerConnection.onconnectionstatechange = () => {
    const connectionState = state.peerConnection.connectionState;
    setConnectionStatus(connectionState);

    if (["closed", "failed", "disconnected"].includes(connectionState)) {
      remoteVideo.srcObject = null;
    }
  };
}

async function makeOffer() {
  if (!state.peerConnection) {
    await createPeerConnection();
  }

  const offer = await state.peerConnection.createOffer();
  await state.peerConnection.setLocalDescription(offer);
  state.socket.emit("signal", {
    roomId: state.roomId,
    targetSocketId: state.remoteSocketId,
    type: "offer",
    payload: offer
  });
  setConnectionStatus("Offer sent");
}

function leaveRoom() {
  if (state.isHost) {
    endSession();
    return;
  }

  if (state.socket && state.roomId) {
    state.socket.emit("room:leave", { roomId: state.roomId });
  }

  teardownSession(false);
}

function endSession() {
  if (!state.socket || !state.roomId) return;

  // Disable button immediately to prevent double-emit
  endSessionBtn.disabled = true;

  // Emit to server — room:ended will be broadcast back to ALL participants
  // including this client. Teardown + redirect happens there for both peers.
  state.socket.emit("room:end", { roomId: state.roomId });
}

function toggleMute() {
  if (!state.localStream) {
    return;
  }

  state.micEnabled = !state.micEnabled;
  for (const track of state.localStream.getAudioTracks()) {
    track.enabled = state.micEnabled;
  }
  muteBtn.textContent = state.micEnabled ? "Mute Microphone" : "Unmute Microphone";
}

function toggleCamera() {
  if (!state.localStream) {
    return;
  }

  state.cameraEnabled = !state.cameraEnabled;
  for (const track of state.localStream.getVideoTracks()) {
    track.enabled = state.cameraEnabled;
  }
  cameraBtn.textContent = state.cameraEnabled ? "Disable Camera" : "Enable Camera";
}

function teardownSession(resetToHome) {
  closePeerConnection();
  stopLocalMedia();
  state.roomId = "";
  state.isHost = false;
  state.remoteSocketId = null;
  updateControls();
  roomSummary.textContent = "Not connected to a room.";
  if (resetToHome) {
    window.location.hash = "";
  }
}

function closePeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.ontrack = null;
    state.peerConnection.onicecandidate = null;
    state.peerConnection.onconnectionstatechange = null;
    state.peerConnection.close();
    state.peerConnection = null;
  }

  remoteVideo.srcObject = null;
}

function stopLocalMedia() {
  if (!state.localStream) {
    return;
  }

  for (const track of state.localStream.getTracks()) {
    track.stop();
  }

  state.localStream = null;
  localVideo.srcObject = null;
  state.micEnabled = true;
  state.cameraEnabled = true;
  muteBtn.textContent = "Mute Microphone";
  cameraBtn.textContent = "Disable Camera";
}

function showLoggedIn() {
  authPanel.classList.add("hidden");
  callPanel.classList.remove("hidden");
  welcomeText.textContent = `Signed in as ${state.username}`;
  updateControls();
  setConnectionStatus("Signed in");
}

function showLoggedOut() {
  authPanel.classList.remove("hidden");
  callPanel.classList.add("hidden");
}

function updateControls() {
  const inRoom = Boolean(state.roomId);
  leaveBtn.disabled = !inRoom;
  muteBtn.disabled = !state.localStream;
  cameraBtn.disabled = !state.localStream;
  endSessionBtn.disabled = !inRoom;
  endSessionBtn.classList.remove("hidden");
}

function updateRoomSummary(participants) {
  roomSummary.textContent = `Room ${state.roomId} • ${participants.length}/2 participants connected`;
}

function setConnectionStatus(text) {
  connectionStatus.textContent = text;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}
