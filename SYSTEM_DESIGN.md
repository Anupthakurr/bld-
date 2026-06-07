# System Design & Architecture

## Overview
This document outlines the architecture and design decisions for the BLD Remote Browser Control System. The goal of this system is to provide a local, web-based UI that can spin up a headless Chromium instance inside a Docker container, stream its visual output in real-time to a canvas, and proxy user interactions back to the headless browser.

## High-Level Architecture Diagram

```text
┌─────────────────────────────────────────────┐
│              USER BROWSER (React UI)        │
│  ┌──────────────────────────────────────┐   │
│  │  <canvas> — renders JPEG frames      │   │
│  │  mouse/keyboard events captured      │   │
│  └──────────┬───────────────────────────┘   │
└─────────────┼───────────────────────────────┘
              │ Socket.IO (WS)
              ▼
┌─────────────────────────────────────────────┐
│         NODE.JS BACKEND (Express)           │
│  - /api/start → spin up Docker container    │
│  - /api/stop  → kill Docker container       │
│  - Socket.IO server:                        │
│    • receives events (click/scroll/key)     │
│    • emits screencast frames                │
│  - Puppeteer connects to container via CDP  │
└──────────────────────┬──────────────────────┘
                       │ CDP (port 9222)
                       ▼
┌─────────────────────────────────────────────┐
│         DOCKER CONTAINER                    │
│  Image: custom (node:20-slim + chromium)    │
│  - Runs Chromium with --remote-debugging-   │
│    port=9222 --remote-debugging-address=    │
│    0.0.0.0                                  │
│  - Port 9222 mapped to host                 │
└─────────────────────────────────────────────┘
```

## Component Details

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
- **Fallback Mechanism:** If the Docker daemon is unreachable, the backend falls back to spawning a local Chromium instance via `puppeteer` as a resilient alternative.

### 3. Container Layer (Docker)
- **Role:** An isolated, ephemeral environment for the headless browser.
- **Base Image:** `node:20-slim` is used to keep the footprint relatively small while providing necessary libraries.
- **Dependencies:** Installs required X11, ALSA, and rendering libraries so Chromium can run headless without crashing.
- **Configuration:** Exposes port 9222 and binds the remote debugging address to `0.0.0.0` so the host Node.js process can connect to the CDP socket.

## Design Decisions

### CDP Streaming vs. X11/VNC
- **Decision:** Use CDP's native `Page.startScreencast`.
- **Reasoning:** Setting up a full virtual frame buffer (Xvfb) and a VNC server inside Docker is heavy and complex. CDP is already built into Chrome. `Page.startScreencast` is specifically designed for remote debugging and provides a stream of JPEG frames, which is perfect for drawing directly onto an HTML5 Canvas.

### Socket.IO for Transport
- **Decision:** Use Socket.IO over bare WebSockets.
- **Reasoning:** Socket.IO handles automatic reconnections, binary payloads (crucial for sending JPEG buffer data without base64 bloat if configured), and provides an easy event-driven API for multiplexing frames, logs, state updates, and input commands over a single connection.

### Viewport and Scaling
- **Decision:** Fixed remote viewport of `1280x720`.
- **Reasoning:** Ensures consistent rendering regardless of the user's monitor size. The frontend scales the received frames to fit its available window area using CSS and Canvas context scaling, and reverse-scales mouse coordinates back to the `1280x720` space before sending them to the backend.
