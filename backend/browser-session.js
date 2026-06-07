'use strict';

const puppeteer = require('puppeteer-core');

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

class BrowserSession {
  constructor(io) {
    this.io = io;
    this.browser = null;
    this.page = null;
    this.cdpSession = null;
    this.isStreaming = false;
    this.frameCount = 0;
    this.lastFrameTime = Date.now();
  }

  /**
   * Connect to the Chromium CDP endpoint already running in Docker.
   */
  async connect(cdpPort = 9222) {
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${cdpPort}`,
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    await this.page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
    });

    // Navigate to a useful default page
    await this.page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {
      return this.page.goto('about:blank');
    });

    await this.startScreencast();
    console.log('[BrowserSession] Connected and screencast started.');
  }

  /**
   * Start the CDP screencast — streams JPEG frames via Socket.IO.
   */
  async startScreencast() {
    if (this.cdpSession) {
      try { await this.cdpSession.detach(); } catch {}
    }

    this.cdpSession = await this.page.createCDPSession();
    this.isStreaming = true;

    await this.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: VIEWPORT_WIDTH,
      maxHeight: VIEWPORT_HEIGHT,
      everyNthFrame: 1,
    });

    this.cdpSession.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
      if (!this.isStreaming) return;

      // Emit the JPEG frame as base64 to all connected clients
      this.io.emit('frame', {
        data,
        timestamp: Date.now(),
        pageUrl: metadata?.pageURL || '',
      });

      // Emit current URL separately for the toolbar
      try {
        const url = this.page.url();
        this.io.emit('url:changed', { url });
      } catch {}

      // CRITICAL: Must ack each frame or Chromium pauses the stream
      await this.cdpSession
        .send('Page.screencastFrameAck', { sessionId })
        .catch(() => {});

      // FPS tracking
      this.frameCount++;
      const now = Date.now();
      if (now - this.lastFrameTime >= 1000) {
        this.io.emit('stats', { fps: this.frameCount });
        this.frameCount = 0;
        this.lastFrameTime = now;
      }
    });
  }

  /**
   * Stop the screencast and disconnect from Chromium.
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
        await this.browser.disconnect();
        this.browser = null;
        this.page = null;
      }
    } catch {}
    console.log('[BrowserSession] Disconnected.');
  }

  // ─── Input Methods ────────────────────────────────────────────────────────

  async click(x, y, button = 'left') {
    if (!this.page) return;
    try {
      await this.page.mouse.click(x, y, { button, delay: 50 });
    } catch (err) {
      console.warn('[BrowserSession] Click error:', err.message);
    }
  }

  async mousedown(x, y, button = 'left') {
    if (!this.page) return;
    try {
      await this.page.mouse.move(x, y);
      await this.page.mouse.down({ button });
    } catch {}
  }

  async mouseup(x, y, button = 'left') {
    if (!this.page) return;
    try {
      await this.page.mouse.move(x, y);
      await this.page.mouse.up({ button });
    } catch {}
  }

  async mousemove(x, y) {
    if (!this.page) return;
    try {
      await this.page.mouse.move(x, y);
    } catch {}
  }

  async scroll(x, y, deltaX, deltaY) {
    if (!this.page) return;
    try {
      await this.page.mouse.move(x, y);
      await this.page.mouse.wheel({ deltaX, deltaY });
    } catch (err) {
      // Fallback: use CDP Input.dispatchMouseEvent
      try {
        await this.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX,
          deltaY,
          modifiers: 0,
        });
      } catch {}
    }
  }

  async type(text) {
    if (!this.page) return;
    try {
      await this.page.keyboard.type(text, { delay: 20 });
    } catch (err) {
      console.warn('[BrowserSession] Type error:', err.message);
    }
  }

  async keyPress(key) {
    if (!this.page) return;
    try {
      await this.page.keyboard.press(key);
    } catch (err) {
      console.warn('[BrowserSession] KeyPress error:', err.message);
    }
  }

  async navigate(url) {
    if (!this.page) return;
    try {
      // Ensure URL has a protocol
      let targetUrl = url;
      if (!/^https?:\/\//i.test(url)) {
        targetUrl = 'https://' + url;
      }
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (err) {
      console.warn('[BrowserSession] Navigate error:', err.message);
    }
  }

  async goBack() {
    if (!this.page) return;
    try { await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }); } catch {}
  }

  async goForward() {
    if (!this.page) return;
    try { await this.page.goForward({ waitUntil: 'domcontentloaded', timeout: 5000 }); } catch {}
  }

  async reload() {
    if (!this.page) return;
    try { await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
  }

  get viewportSize() {
    return { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
  }
}

module.exports = BrowserSession;
