# BLD Remote Browser Control System

A mini TeamViewer for browsers — control a headless Chromium instance inside Docker from your web UI in real-time.

## What It Does

- Click **"Start Browser"** in the web UI
- A Docker container spins up running headless Chromium
- The browser screen streams live to your UI via WebSocket (CDP `Page.startScreencast`)
- You can **click, scroll, and type** from the UI — actions replay inside Chromium

## Architecture

```
React UI (canvas) ←─ Socket.IO ──→ Node.js Backend ←─ Puppeteer/CDP ──→ Docker (Chromium)
```

| Layer | Tech |
|-------|------|
| Frontend | React + Vite, Vanilla CSS |
| Real-time | Socket.IO (WebSockets) |
| Backend | Node.js, Express |
| Browser control | Puppeteer-core + Chrome DevTools Protocol |
| Container | Docker via Dockerode, custom Chromium image |

## System Design

This system provides a local, web-based UI that can spin up a headless Chromium instance inside a Docker container, stream its visual output in real-time to a canvas, and proxy user interactions back to the headless browser.

### 1. Frontend Layer (React + Vite)
- **Role:** The client-facing interface that renders the browser view and captures user inputs.
- **Key Technology:** A `<canvas>` element is used to draw the incoming JPEG frames efficiently.
- **Real-time Communication:** Connects to the backend via Socket.IO.
- **Event Handling:** Mouse clicks, movements, scrolling, and keyboard events are intercepted on the canvas. Coordinates are scaled from the canvas dimensions to the target 1280x720 remote viewport dimensions before being transmitted.

### 2. Backend Layer (Node.js + Express)
- **Role:** The orchestration layer that acts as a bridge between the Web UI and the Chromium instance.
- **Docker Management:** Uses `dockerode` to programmatically pull the custom image, spawn the container, bind ports, and eventually stop/remove the container.
- **Browser Control:** Uses `puppeteer-core` to establish a Chrome DevTools Protocol (CDP) session with the Chromium instance running on port 9222.
- **Screencast Pipeline:** Subscribes to the `Page.screencastFrame` CDP event. As Chromium pushes JPEG frames, the backend forwards them immediately to the frontend via Socket.IO, and acknowledges the frame to Chromium (`Page.screencastFrameAck`) to keep the stream flowing.
- **Fallback Mechanism:** If the Docker daemon is unreachable on the host system, the backend falls back to spawning a local system Chrome/Edge instance via `puppeteer-core` as a resilient alternative to ensure the UI remains fully testable.

### 3. Container Layer (Docker)
- **Role:** An isolated, ephemeral environment for the headless browser.
- **Base Image:** `node:20-slim` is used to keep the footprint relatively small while providing necessary libraries.
- **Dependencies:** Installs required X11, ALSA, and rendering libraries so Chromium can run headless without crashing.
- **Configuration:** Exposes port 9222 and binds the remote debugging address to `0.0.0.0` so the host Node.js process can connect to the CDP socket.

### Design Decisions

#### CDP Streaming vs. X11/VNC
- **Decision:** Use CDP's native `Page.startScreencast`.
- **Reasoning:** Setting up a full virtual frame buffer (Xvfb) and a VNC server inside Docker is heavy and complex. CDP is already built into Chrome. `Page.startScreencast` is specifically designed for remote debugging and provides a stream of JPEG frames, which is perfect for drawing directly onto an HTML5 Canvas without heavy encoding overhead.

#### Socket.IO for Transport
- **Decision:** Use Socket.IO over bare WebSockets.
- **Reasoning:** Socket.IO handles automatic reconnections, binary payloads, and provides an easy event-driven API for multiplexing frames, logs, state updates, and input commands over a single connection.

#### Viewport and Scaling
- **Decision:** Fixed remote viewport of `1280x720`.
- **Reasoning:** Ensures consistent rendering regardless of the user's monitor size. The frontend scales the received frames to fit its available window area using CSS and Canvas context scaling, and reverse-scales mouse coordinates back to the `1280x720` space before sending them to the backend to ensure pixel-perfect clicks.

## Prerequisites

- Docker Desktop (running)
- Node.js 18+
- Ports 3001, 5173, 9222 free

## Quick Start

### 1. Build the Docker image
```bash
cd docker
docker build -t bld-chromium .
```

### 2. Start the backend
```bash
cd backend
npm install
node server.js
```

### 3. Start the frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. Open in browser
Navigate to **http://localhost:5173** and click **"Start Browser"**.

> **Note:** The first "Start Browser" click may take 1–2 minutes to build the Docker image. Subsequent starts are instant.

## Project Structure

```
bld/
├── docker/
│   └── Dockerfile          # Headless Chromium image
├── backend/
│   ├── server.js           # Express + Socket.IO server
│   ├── docker-manager.js   # Container lifecycle (dockerode)
│   ├── browser-session.js  # Puppeteer CDP session + input
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Root, socket management
│   │   ├── components/
│   │   │   ├── BrowserViewer.jsx # Canvas, input forwarding
│   │   │   ├── Toolbar.jsx       # URL bar, nav controls
│   │   │   └── StatusBar.jsx     # FPS, connection status
│   │   └── index.css             # Dark premium theme
│   └── package.json
└── README.md
```
