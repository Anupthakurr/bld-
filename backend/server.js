'use strict';

const express = require('express');
const http    = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors    = require('cors');
const dockerManager = require('./docker-manager');
const BrowserSession = require('./browser-session');

const PORT     = 3001;
const CDP_PORT = 9222;

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io     = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e7,
});

// ─── State ────────────────────────────────────────────────────────────────────

let browserSession = null;
let browserState   = 'stopped'; // 'stopped' | 'starting' | 'running' | 'stopping'
let sessionMode    = null;      // 'docker' | 'local'

function setState(state) {
  browserState = state;
  io.emit('browser:state', { state, mode: sessionMode });
  console.log(`[Server] State → ${state}${sessionMode ? ` (${sessionMode})` : ''}`);
}

function broadcastLog(msg) {
  io.emit('log', { message: msg, timestamp: Date.now() });
  console.log(`[Server] ${msg}`);
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({ state: browserState, mode: sessionMode, viewport: browserSession?.viewportSize || null });
});

app.post('/api/browser/start', async (req, res) => {
  if (browserState !== 'stopped') {
    return res.status(409).json({ error: `Browser is already ${browserState}` });
  }
  res.json({ ok: true, message: 'Starting browser…' });
  startBrowser().catch((err) => {
    broadcastLog(`ERROR: ${err.message}`);
    setState('stopped');
  });
});

app.post('/api/browser/stop', async (req, res) => {
  if (browserState === 'stopped') {
    return res.status(409).json({ error: 'Browser is not running' });
  }
  res.json({ ok: true, message: 'Stopping…' });
  stopBrowser().catch(() => setState('stopped'));
});

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

async function startBrowser() {
  setState('starting');
  sessionMode = null;

  // ── Attempt 1: Docker ───────────────────────────────────────────────────────
  const dockerAvailable = await isDockerAvailable();

  if (dockerAvailable) {
    try {
      broadcastLog('Docker detected — starting container…');
      await dockerManager.startContainer((msg) => broadcastLog(msg));

      broadcastLog('Connecting to Chromium via CDP…');
      browserSession = new BrowserSession(io);
      await browserSession.connectToDocker(CDP_PORT);

      sessionMode = 'docker';
      setState('running');
      broadcastLog('🐳 Browser live (Docker mode)!');
      io.emit('browser:ready', { ...browserSession.viewportSize, mode: 'docker' });
      return;
    } catch (dockerErr) {
      broadcastLog(`Docker mode failed: ${dockerErr.message}`);
      browserSession = null;
      await dockerManager.stopContainer().catch(() => {});
    }
  } else {
    broadcastLog('Docker not available — using local Chromium fallback…');
  }

  // ── Attempt 2: Local Puppeteer (bundled Chromium) ───────────────────────────
  try {
    broadcastLog('Launching local Chromium (puppeteer)…');
    browserSession = new BrowserSession(io);
    await browserSession.launchLocal();

    sessionMode = 'local';
    setState('running');
    broadcastLog('✅ Browser live (Local Chromium mode)!');
    io.emit('browser:ready', { ...browserSession.viewportSize, mode: 'local' });
  } catch (localErr) {
    broadcastLog(`Local Chromium also failed: ${localErr.message}`);
    browserSession = null;
    setState('stopped');
    throw localErr;
  }
}

async function stopBrowser() {
  setState('stopping');
  broadcastLog('Stopping browser…');
  try {
    if (browserSession) {
      await browserSession.disconnect();
      browserSession = null;
    }
    if (sessionMode === 'docker') {
      await dockerManager.stopContainer();
    }
    broadcastLog('Browser stopped.');
  } catch (err) {
    broadcastLog(`Stop error: ${err.message}`);
  }
  sessionMode = null;
  setState('stopped');
}

/**
 * Quick check: can we reach the Docker daemon?
 */
async function isDockerAvailable() {
  try {
    const Docker = require('dockerode');
    const docker = new Docker();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

// ─── Socket.IO Events ─────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  socket.emit('browser:state', { state: browserState, mode: sessionMode });

  socket.on('mouse:click',  async ({ x, y, button }) => browserSession?.click(x, y, button || 'left').catch(() => {}));
  socket.on('mouse:down',   async ({ x, y, button }) => browserSession?.mousedown(x, y, button || 'left').catch(() => {}));
  socket.on('mouse:up',     async ({ x, y, button }) => browserSession?.mouseup(x, y, button || 'left').catch(() => {}));
  socket.on('mouse:move',   async ({ x, y })          => browserSession?.mousemove(x, y).catch(() => {}));
  socket.on('mouse:scroll', async ({ x, y, deltaX, deltaY }) => browserSession?.scroll(x, y, deltaX, deltaY).catch(() => {}));

  socket.on('keyboard:type', async ({ text }) => browserSession?.type(text).catch(() => {}));
  socket.on('keyboard:key',  async ({ key })  => browserSession?.keyPress(key).catch(() => {}));

  socket.on('navigate',    async ({ url }) => { broadcastLog(`→ ${url}`); browserSession?.navigate(url).catch(() => {}); });
  socket.on('nav:back',    async () => browserSession?.goBack().catch(() => {}));
  socket.on('nav:forward', async () => browserSession?.goForward().catch(() => {}));
  socket.on('nav:reload',  async () => browserSession?.reload().catch(() => {}));

  socket.on('disconnect', () => console.log(`[Socket] Disconnected: ${socket.id}`));
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 BLD Remote Browser Backend — http://localhost:${PORT}`);
  console.log('   Modes: Docker (primary) → Local Chromium (fallback)\n');
});

process.on('SIGINT', async () => {
  console.log('\nShutting down…');
  if (browserSession) await browserSession.disconnect().catch(() => {});
  if (sessionMode === 'docker') await dockerManager.stopContainer().catch(() => {});
  process.exit(0);
});
