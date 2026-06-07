'use strict';

const puppeteerCore = require('puppeteer-core');

// Bundled Chromium from the full puppeteer package (fallback)
let puppeteerFull = null;
try {
  puppeteerFull = require('puppeteer');
} catch {
  // Not installed yet — fallback won't be available
}

const VIEWPORT_WIDTH  = 1280;
const VIEWPORT_HEIGHT = 720;

class BrowserSession {
  constructor(io) {
    this.io          = io;
    this.browser     = null;
    this.page        = null;
    this.cdpSession  = null;
    this.isStreaming = false;
    this.frameCount  = 0;
    this.lastFrameTime = Date.now();
    this.mode        = 'unknown'; // 'docker' | 'local'
  }

  /**
   * Connect to an existing CDP endpoint (Docker container).
   */
  async connectToDocker(cdpPort = 9222) {
    this.mode    = 'docker';
    this.browser = await puppeteerCore.connect({
      browserURL: `http://127.0.0.1:${cdpPort}`,
      defaultViewport: null,
    });
    await this._setupPage();
  }

  /**
   * Launch using the system-installed Chrome/Edge.
   * Uses puppeteer-core + executablePath to avoid the bundled binary issue on Windows.
   */
  async launchLocal() {
    const executablePath = this._findSystemBrowser();
    if (!executablePath) {
      throw new Error('No system Chrome/Edge found. Please install Google Chrome.');
    }

    console.log(`[BrowserSession] Using browser: ${executablePath}`);
    this.mode    = 'local';
    this.browser = await puppeteerCore.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,720',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
      ],
      defaultViewport: null,
    });
    await this._setupPage();
  }

  /**
   * Find the first available system browser executable.
   */
  _findSystemBrowser() {
    const fs   = require('fs');
    const os   = require('os');
    const candidates = [];

    if (os.platform() === 'win32') {
      candidates.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
      );
    } else if (os.platform() === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      );
    } else {
      candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
    }

    for (const p of candidates) {
      try { if (p && fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  /**
   * Shared page setup after browser is connected/launched.
   */
  async _setupPage() {
    const pages = await this.browser.pages();
    this.page   = pages[0] || (await this.browser.newPage());

    await this.page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    await this.page
      .goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 })
      .catch(() => this.page.goto('about:blank'));

    await this._startScreencast();
    console.log(`[BrowserSession] Ready in ${this.mode} mode.`);
  }

  /**
   * Start the CDP screencast — streams JPEG frames via Socket.IO.
   */
  async _startScreencast() {
    if (this.cdpSession) {
      try { await this.cdpSession.detach(); } catch {}
    }

    this.cdpSession  = await this.page.createCDPSession();
    this.isStreaming = true;

    await this.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: VIEWPORT_WIDTH,
      maxHeight: VIEWPORT_HEIGHT,
      everyNthFrame: 1,
    });

    this.cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
      if (!this.isStreaming) return;

      this.io.emit('frame', { data, timestamp: Date.now() });

      // Emit current URL
      try { this.io.emit('url:changed', { url: this.page.url() }); } catch {}

      // CRITICAL: must ack every frame or Chromium pauses the stream
      await this.cdpSession
        .send('Page.screencastFrameAck', { sessionId })
        .catch(() => {});

      // FPS counter
      this.frameCount++;
      const now = Date.now();
      if (now - this.lastFrameTime >= 1000) {
        this.io.emit('stats', { fps: this.frameCount });
        this.frameCount    = 0;
        this.lastFrameTime = now;
      }
    });
  }

  /**
   * Stop screencast and close the browser.
   */
  async disconnect() {
    this.isStreaming = false;
    try {
      if (this.cdpSession) {
        await this.cdpSession.send('Page.stopScreencast').catch(() => {});
        await this.cdpSession.detach().catch(() => {});
        this.cdpSession = null;
      }
    } catch {}

    try {
      if (this.browser) {
        if (this.mode === 'local') {
          await this.browser.close();
        } else {
          await this.browser.disconnect();
        }
        this.browser = null;
        this.page    = null;
      }
    } catch {}

    console.log('[BrowserSession] Disconnected.');
  }

  // ─── Input Methods ─────────────────────────────────────────────────────────

  async click(x, y, button = 'left') {
    if (!this.page) return;
    try { await this.page.mouse.click(x, y, { button, delay: 30 }); } catch {}
  }

  async mousedown(x, y, button = 'left') {
    if (!this.page) return;
    try { await this.page.mouse.move(x, y); await this.page.mouse.down({ button }); } catch {}
  }

  async mouseup(x, y, button = 'left') {
    if (!this.page) return;
    try { await this.page.mouse.move(x, y); await this.page.mouse.up({ button }); } catch {}
  }

  async mousemove(x, y) {
    if (!this.page) return;
    try { await this.page.mouse.move(x, y); } catch {}
  }

  async scroll(x, y, deltaX, deltaY) {
    if (!this.page) return;
    try {
      await this.page.mouse.move(x, y);
      await this.page.mouse.wheel({ deltaX, deltaY });
    } catch {
      try {
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: 0,
        });
      } catch {}
    }
  }

  async type(text) {
    if (!this.page) return;
    try { await this.page.keyboard.type(text, { delay: 20 }); } catch {}
  }

  async keyPress(key) {
    if (!this.page) return;
    try { await this.page.keyboard.press(key); } catch {}
  }

  async navigate(url) {
    if (!this.page) return;
    try {
      const targetUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch {}
  }

  async goBack()    { if (this.page) await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}); }
  async goForward() { if (this.page) await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}); }
  async reload()    { if (this.page) await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); }

  get viewportSize() { return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }; }
}

module.exports = BrowserSession;
