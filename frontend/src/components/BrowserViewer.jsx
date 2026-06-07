import { useCallback, useEffect, useRef, useState } from 'react';

const CANVAS_WIDTH  = 1280;
const CANVAS_HEIGHT = 720;

export default function BrowserViewer({ socket, isActive, isStarting, onStart, logs }) {
  const canvasRef   = useRef(null);
  const wrapRef     = useRef(null);
  const [scale, setScale]     = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: CANVAS_WIDTH, h: CANVAS_HEIGHT });

  // ── Scale canvas to fit the available area ──────────────────────────────────
  useEffect(() => {
    const updateScale = () => {
      if (!wrapRef.current) return;
      const { clientWidth: W, clientHeight: H } = wrapRef.current;
      const padding = 40;
      const scaleX = (W - padding) / CANVAS_WIDTH;
      const scaleY = (H - padding) / CANVAS_HEIGHT;
      const s = Math.min(scaleX, scaleY, 1);
      setScale(s);
      setCanvasSize({ w: Math.round(CANVAS_WIDTH * s), h: Math.round(CANVAS_HEIGHT * s) });
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Draw incoming frames onto the canvas ────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const handleFrame = ({ data }) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      };
      img.src = `data:image/jpeg;base64,${data}`;
    };

    socket.on('frame', handleFrame);
    return () => socket.off('frame', handleFrame);
  }, [socket]);

  // ── Coordinate scaling helper ────────────────────────────────────────────────
  const toRemote = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) / scale);
    const y = Math.round((clientY - rect.top)  / scale);
    return {
      x: Math.max(0, Math.min(x, CANVAS_WIDTH  - 1)),
      y: Math.max(0, Math.min(y, CANVAS_HEIGHT - 1)),
    };
  }, [scale]);

  // ── Mouse events ─────────────────────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    if (!socket || !isActive) return;
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:click', { x, y, button: e.button === 2 ? 'right' : 'left' });
    // Give canvas focus so keyboard works
    canvasRef.current?.focus();
  }, [socket, isActive, toRemote]);

  const handleMouseMove = useCallback((e) => {
    if (!socket || !isActive) return;
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:move', { x, y });
  }, [socket, isActive, toRemote]);

  const handleWheel = useCallback((e) => {
    if (!socket || !isActive) return;
    e.preventDefault();
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:scroll', { x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [socket, isActive, toRemote]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  // ── Keyboard events ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (!socket || !isActive) return;

    // Special keys forwarded as keyPress
    const specialKeys = [
      'Enter', 'Tab', 'Backspace', 'Delete', 'Escape',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown',
      'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    ];

    if (specialKeys.includes(e.key)) {
      e.preventDefault();
      socket.emit('keyboard:key', { key: e.key });
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+combinations
      e.preventDefault();
      const combo = `${e.ctrlKey ? 'Control+' : ''}${e.key}`;
      socket.emit('keyboard:key', { key: e.key.toUpperCase() });
    }
    // Regular characters are handled by handleKeyPress
  }, [socket, isActive]);

  const handleKeyPress = useCallback((e) => {
    if (!socket || !isActive) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1) {
      socket.emit('keyboard:type', { text: e.key });
    }
  }, [socket, isActive]);

  // ── Render idle state ────────────────────────────────────────────────────────
  const showIdle     = !isActive && !isStarting;
  const showStarting = isStarting;

  return (
    <div className="browser-viewer-wrap" ref={wrapRef}>
      {/* The actual canvas — always mounted so we can draw to it */}
      <div
        className={`browser-canvas-container ${isActive ? 'active' : ''}`}
        style={{ display: isActive ? 'block' : 'none' }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          style={{ width: canvasSize.w, height: canvasSize.h }}
          className={`browser-canvas ${isActive ? 'interactive' : ''}`}
          tabIndex={0}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onKeyPress={handleKeyPress}
          onContextMenu={handleContextMenu}
        />
      </div>

      {/* Idle overlay */}
      {showIdle && (
        <div className="idle-overlay">
          <div className="idle-icon">🌐</div>
          <h1 className="idle-title">Remote Browser Control</h1>
          <p className="idle-sub">
            Spin up a headless Chromium instance inside Docker and control it in real‑time from your browser.
          </p>
          <button className="idle-cta" id="start-browser-btn" onClick={onStart}>
            <span>▶</span>
            Start Browser
          </button>
        </div>
      )}

      {/* Starting overlay */}
      {showStarting && (
        <div className="starting-overlay">
          <div className="starting-spinner" />
          <div className="starting-title">Launching Chromium…</div>
          <div className="starting-log">
            {logs.map((msg, i) => (
              <div key={i} className="log-line">› {msg}</div>
            ))}
            {logs.length === 0 && (
              <div className="log-line">Connecting to Docker daemon…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
