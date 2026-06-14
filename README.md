# Secure 1-to-1 Video Calling App

Browser-based private video calling application built with Node.js, Express, Socket.IO, and WebRTC. The server only performs authentication, room coordination, and signaling. Audio, video, and in-session state remain in memory and are not stored server-side.

## Demo

Try the live application:

🔗 https://chatty-ofte.onrender.com

### Demo Accounts

| Username | Password |
|----------|----------|
| alice | password123 |
| bob | password123 |

> Use either account to log in and test the application.

## 1. Complete Project Structure

```text
.
├── Dockerfile
├── README.md
├── docker-compose.yml
├── package.json
├── public
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── src
    ├── auth.js
    ├── config.js
    ├── logger.js
    ├── rateLimit.js
    ├── rooms.js
    └── server.js
```

## 2. Backend Implementation

- `Express` serves the static application, authentication endpoints, and health check.
- `Socket.IO` runs over the same HTTPS server and only allows authenticated connections.
- `JWT` is required for both API access and signaling socket access.
- `RoomStore` keeps room membership in memory only and enforces a hard two-user limit.
- Operational logs are limited to auth success/failure, join, leave, room end, socket lifecycle, and server errors.
- Global and auth-specific rate limiting reduce brute-force and request flooding.

### API Endpoints

- `POST /api/auth/login`
  - Input: `{ "username": "alice", "password": "password123" }`
  - Output: `{ "token": "<jwt>" }`
- `GET /api/session`
  - Validates the JWT and returns the authenticated user.
- `GET /api/config`
  - Returns ICE server configuration after authentication.
- `GET /api/health`
  - Health endpoint for probes and uptime checks.

## 3. Frontend Implementation

- `index.html` provides a browser UI with:
  - Join Call
  - Leave Call
  - Mute/Unmute Microphone
  - Enable/Disable Camera
  - Connection Status Indicator
- `app.js` handles:
  - Login and token storage
  - Socket authentication
  - Local media acquisition
  - WebRTC peer connection creation
  - Offer/answer/ICE exchange
  - Graceful teardown when a peer leaves or host ends the room
- `styles.css` provides a responsive layout that works on desktop and mobile browsers.

## 4. WebRTC Signaling Flow

1. User authenticates with `POST /api/auth/login` and receives a JWT.
2. Browser opens a secure `wss://` Socket.IO connection using the JWT.
3. First authenticated user joins a room and becomes the host.
4. Second authenticated user joins the same room. No third participant is allowed.
5. The second user creates a WebRTC offer and sends it through Socket.IO signaling.
6. The host sets the remote description, creates an answer, and sends it back.
7. Both peers exchange ICE candidates through Socket.IO until the peer-to-peer path is established.
8. Media flows directly between browsers over WebRTC using DTLS-SRTP encryption.
9. If one user leaves, the remaining peer closes the RTCPeerConnection gracefully.
10. If the host ends the session, the server emits `room:ended`, disconnects both users from the room, and both clients return to the home state.

## 5. Security Considerations

- HTTPS is mandatory. In production the server refuses to start without a certificate and private key.
- Socket.IO is restricted to WebSocket transport to keep signaling on secure `wss://`.
- JWTs authenticate both REST and signaling traffic.
- Room membership is held only in memory; there is no database and no content persistence.
- No media or chat content is routed through or stored on the server.
- WebRTC media uses browser-native DTLS-SRTP encryption end to end between peers.
- Helmet hardens HTTP headers and a CSP restricts the page to self-hosted assets.
- Express rate limiting and per-socket event throttling reduce abuse and signaling floods.
- Signaling logs never include SDP payloads, ICE candidates, or user media content.
- No recording functionality is implemented server-side or client-side.

## 6. Docker Setup

### Build

```bash
npm install
docker build -t secure-video-call-app .
```

### Run

```bash
cp .env.example .env
docker compose up --build
```

For production, mount certificates into `./certs` and set:

```env
NODE_ENV=production
TLS_KEY_PATH=/run/certs/tls.key
TLS_CERT_PATH=/run/certs/tls.crt
JWT_SECRET=<long-random-secret>
AUTH_USERS=alice:<strong-password>,bob:<strong-password>
```

## 7. Local Development Instructions

1. Install Node.js 20+.
2. Copy environment variables:

```bash
cp .env.example .env
```

3. Install dependencies:

```bash
npm install
```

4. Start the server:

```bash
npm run dev
```

5. Open:

```text
https://localhost:3443
```

In development, the app generates a short-lived self-signed certificate in memory. Your browser will warn until you trust the local certificate. For cross-network connectivity, configure TURN credentials in `.env`.

## 8. Production Deployment Guide

1. Provision a host or container platform that supports TLS certificate mounting.
2. Use a real certificate from your ingress, reverse proxy, or certificate manager.
3. Set `NODE_ENV=production`, `JWT_SECRET`, `AUTH_USERS`, `TLS_KEY_PATH`, and `TLS_CERT_PATH`.
4. Add TURN infrastructure for NAT traversal in restrictive networks.
5. Run behind a firewall that only exposes HTTPS.
6. If deploying behind a reverse proxy, keep the browser-facing scheme as HTTPS and preserve WebSocket upgrades.
7. Replace demo credentials with a real identity system or an upstream auth provider that issues JWTs.
8. Monitor only operational logs and health checks; do not add content logging.

## Notes

- This implementation intentionally uses in-memory users and room state to satisfy the no-persistence requirement and keep the example compact.
- For production, integrate a proper identity provider, secret manager, and certificate automation pipeline.
- If you later add text chat, keep it strictly in memory on the clients or ephemeral socket state only, with no server-side storage.
