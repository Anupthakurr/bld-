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

### Streaming
The backend uses CDP's `Page.startScreencast` event — Chromium natively pushes JPEG frames whenever the screen changes. This is far more efficient than polling screenshots. Each frame must be acknowledged with `Page.screencastFrameAck` or the stream pauses.

### Input
Mouse and keyboard events are captured on the canvas, scaled from canvas-space to browser-viewport-space, and sent via Socket.IO to the backend, which replays them via Puppeteer's `page.mouse` and `page.keyboard` APIs.

### Container Lifecycle
1. Backend receives `POST /api/browser/start`
2. `dockerode` builds the image (first run only) then creates and starts the container with port 9222 mapped
3. Backend polls `http://localhost:9222/json/version` until Chromium's CDP is ready
4. Puppeteer connects, opens a page, sets 1280×720 viewport, starts screencast
5. `POST /api/browser/stop` disconnects Puppeteer, stops and removes the container

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
