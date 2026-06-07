import { useCallback, useEffect, useRef, useState } from 'react';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

export default function BrowserViewer({ socketRef, socketConnected, isActive, isStarting, onStart, logs }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: CANVAS_WIDTH, h: CANVAS_HEIGHT });

  useEffect(() => {
    const updateScale = () => {
      if (!wrapRef.current) return;
      const { clientWidth: width, clientHeight: height } = wrapRef.current;
      const padding = 72;
      const scaleX = (width - padding) / CANVAS_WIDTH;
      const scaleY = (height - padding - 34) / CANVAS_HEIGHT;
      const nextScale = Math.min(scaleX, scaleY, 1);
      setScale(nextScale);
      setCanvasSize({
        w: Math.round(CANVAS_WIDTH * nextScale),
        h: Math.round(CANVAS_HEIGHT * nextScale),
      });
    };

    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
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
  }, [socketRef, socketConnected]);

  const toRemote = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((clientX - rect.left) / scale);
    const y = Math.round((clientY - rect.top) / scale);
    return {
      x: Math.max(0, Math.min(x, CANVAS_WIDTH - 1)),
      y: Math.max(0, Math.min(y, CANVAS_HEIGHT - 1)),
    };
  }, [scale]);

  const handleClick = useCallback((e) => {
    const socket = socketRef.current;
    if (!socket || !isActive) return;
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:click', { x, y, button: e.button === 2 ? 'right' : 'left' });
    canvasRef.current?.focus();
  }, [socketRef, isActive, toRemote]);

  const handleMouseMove = useCallback((e) => {
    const socket = socketRef.current;
    if (!socket || !isActive) return;
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:move', { x, y });
  }, [socketRef, isActive, toRemote]);

  const handleWheel = useCallback((e) => {
    const socket = socketRef.current;
    if (!socket || !isActive) return;
    e.preventDefault();
    const { x, y } = toRemote(e.clientX, e.clientY);
    socket.emit('mouse:scroll', { x, y, deltaX: e.deltaX, deltaY: e.deltaY });
  }, [socketRef, isActive, toRemote]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleKeyDown = useCallback((e) => {
    const socket = socketRef.current;
    if (!socket || !isActive) return;

    const specialKeys = [
      'Enter', 'Tab', 'Backspace', 'Delete', 'Escape',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Home', 'End', 'PageUp', 'PageDown',
      'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    ];

    if (specialKeys.includes(e.key)) {
      e.preventDefault();
      socket.emit('keyboard:key', { key: e.key });
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      socket.emit('keyboard:key', { key: e.key.toUpperCase() });
    }
  }, [socketRef, isActive]);

  const handleKeyPress = useCallback((e) => {
    const socket = socketRef.current;
    if (!socket || !isActive) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1) {
      socket.emit('keyboard:type', { text: e.key });
    }
  }, [socketRef, isActive]);

  const showIdle = !isActive && !isStarting;

  return (
    <div className="browser-viewer-wrap" ref={wrapRef}>
      <div className="viewer-chrome">
        <div className="window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="viewer-title">Headless Chromium stream</div>
        <div className="viewer-resolution">1280 x 720</div>
      </div>

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

      {showIdle && (
        <div className="idle-overlay">
          <div className="idle-icon">BLD</div>
          <h1 className="idle-title">Start a controlled browser</h1>
          <p className="idle-sub">
            Launch Chromium in Docker, stream the screen here, and route your clicks,
            scrolls, and keystrokes into the remote page.
          </p>
          <button className="idle-cta" id="start-browser-btn" onClick={onStart}>
            Start Browser
          </button>
        </div>
      )}

      {isStarting && (
        <div className="starting-overlay">
          <div className="starting-spinner" />
          <div className="starting-title">Launching Chromium...</div>
          <div className="starting-log">
            {logs.map((msg, i) => (
              <div key={`${msg}-${i}`} className="log-line">&gt; {msg}</div>
            ))}
            {logs.length === 0 && (
              <div className="log-line">&gt; Connecting to Docker daemon...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
