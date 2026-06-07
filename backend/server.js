'use strict';

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const dockerManager = require('./docker-manager');
const BrowserSession = require('./browser-session');

const PORT = 3001;
const CDP_PORT = 9222;

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e7, // 10MB for large frames
});

// ─── State ────────────────────────────────────────────────────────────────────

let browserSession = null;
let browserState = 'stopped'; // 'stopped' | 'starting' | 'running' | 'stopping'

function setState(state) {
  browserState = state;
  io.emit('browser:state', { state });
  console.log(`[Server] Browser state → ${state}`);
}

function broadcastLog(msg) {
  io.emit('log', { message: msg, timestamp: Date.now() });
  console.log(`[Server] LOG: ${msg}`);
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    state: browserState,
    viewport: browserSession?.viewportSize || null,
  });
});

app.post('/api/browser/start', async (req, res) => {
  if (browserState !== 'stopped') {
    return res.status(409).json({ error: `Browser is already ${browserState}` });
  }

  res.json({ ok: true, message: 'Starting browser...' });

  // Run async — progress goes via Socket.IO
  startBrowser().catch((err) => {
    broadcastLog(`ERROR: ${err.message}`);
    setState('stopped');
  });
});

app.post('/api/browser/stop', async (req, res) => {
  if (browserState === 'stopped') {
    return res.status(409).json({ error: 'Browser is not running' });
  }

  res.json({ ok: true, message: 'Stopping browser...' });

  stopBrowser().catch((err) => {
    console.error('Error stopping browser:', err);
    setState('stopped');
  });
});

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

async function startBrowser() {
  setState('starting');

  try {
    // 1. Start Docker container
    await dockerManager.startContainer((msg) => broadcastLog(msg));

    // 2. Connect Puppeteer + start screencast
    broadcastLog('Connecting to Chromium via CDP...');
    browserSession = new BrowserSession(io);
    await browserSession.connect(CDP_PORT);

    setState('running');
    broadcastLog('Browser is live! You can now interact with it.');
    io.emit('browser:ready', browserSession.viewportSize);
  } catch (err) {
    broadcastLog(`Failed to start browser: ${err.message}`);
    setState('stopped');
    // Try to clean up
    await dockerManager.stopContainer().catch(() => {});
    browserSession = null;
    throw err;
  }
}

async function stopBrowser() {
  setState('stopping');
  broadcastLog('Stopping browser session...');

  try {
    if (browserSession) {
      await browserSession.disconnect();
      browserSession = null;
    }
    await dockerManager.stopContainer();
    broadcastLog('Browser stopped.');
  } catch (err) {
    broadcastLog(`Error during stop: ${err.message}`);
  }

  setState('stopped');
}

// ─── Socket.IO Event Handling ─────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('browser:state', { state: browserState });

  // ── Mouse Events ──────────────────────────────────────────────────────────

  socket.on('mouse:click', async ({ x, y, button }) => {
    if (!browserSession) return;
    await browserSession.click(x, y, button || 'left').catch(console.warn);
  });

  socket.on('mouse:down', async ({ x, y, button }) => {
    if (!browserSession) return;
    await browserSession.mousedown(x, y, button || 'left').catch(console.warn);
  });

  socket.on('mouse:up', async ({ x, y, button }) => {
    if (!browserSession) return;
    await browserSession.mouseup(x, y, button || 'left').catch(console.warn);
  });

  socket.on('mouse:move', async ({ x, y }) => {
    if (!browserSession) return;
    await browserSession.mousemove(x, y).catch(() => {});
  });

  socket.on('mouse:scroll', async ({ x, y, deltaX, deltaY }) => {
    if (!browserSession) return;
    await browserSession.scroll(x, y, deltaX, deltaY).catch(console.warn);
  });

  // ── Keyboard Events ───────────────────────────────────────────────────────

  socket.on('keyboard:type', async ({ text }) => {
    if (!browserSession) return;
    await browserSession.type(text).catch(console.warn);
  });

  socket.on('keyboard:key', async ({ key }) => {
    if (!browserSession) return;
    await browserSession.keyPress(key).catch(console.warn);
  });

  // ── Navigation ────────────────────────────────────────────────────────────

  socket.on('navigate', async ({ url }) => {
    if (!browserSession) return;
    broadcastLog(`Navigating to: ${url}`);
    await browserSession.navigate(url).catch(console.warn);
  });

  socket.on('nav:back', async () => {
    if (!browserSession) return;
    await browserSession.goBack().catch(() => {});
  });

  socket.on('nav:forward', async () => {
    if (!browserSession) return;
    await browserSession.goForward().catch(() => {});
  });

  socket.on('nav:reload', async () => {
    if (!browserSession) return;
    await browserSession.reload().catch(() => {});
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 BLD Remote Browser Backend running at http://localhost:${PORT}`);
  console.log(`   Socket.IO ready for connections\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  if (browserSession) await browserSession.disconnect().catch(() => {});
  await dockerManager.stopContainer().catch(() => {});
  process.exit(0);
});
