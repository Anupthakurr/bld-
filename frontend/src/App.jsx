import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import BrowserViewer from './components/BrowserViewer.jsx';
import Toolbar from './components/Toolbar.jsx';
import StatusBar from './components/StatusBar.jsx';

const BACKEND_URL = 'http://localhost:3001';

export default function App() {
  const socketRef = useRef(null);
  const logBodyRef = useRef(null);

  const [socketConnected, setSocketConnected] = useState(false);
  const [browserState, setBrowserState] = useState('stopped');
  const [sessionMode, setSessionMode] = useState(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [fps, setFps] = useState(null);
  const [logs, setLogs] = useState([]);
  const [startLogs, setStartLogs] = useState([]);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLogs((prev) => [...prev.slice(-199), { msg, time }]);
  }, []);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      addLog('Connected to backend');
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
      addLog('Disconnected from backend');
    });

    socket.on('browser:state', ({ state, mode }) => {
      setBrowserState(state);
      if (mode !== undefined) setSessionMode(mode);
      if (state === 'stopped') {
        setCurrentUrl('');
        setFps(null);
        setStartLogs([]);
        setSessionMode(null);
      }
    });

    socket.on('browser:ready', ({ mode } = {}) => {
      if (mode) setSessionMode(mode);
      addLog(`Browser is live${mode ? ` (${mode} mode)` : ''}`);
      setStartLogs([]);
    });

    socket.on('url:changed', ({ url }) => {
      setCurrentUrl(url);
    });

    socket.on('stats', ({ fps: f }) => {
      setFps(f);
    });

    socket.on('log', ({ message }) => {
      addLog(message);
      setStartLogs((prev) => [...prev.slice(-19), message]);
    });

    return () => {
      socketRef.current = null;
      socket.disconnect();
    };
  }, [addLog]);

  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [logs]);

  const handleStart = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/browser/start`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json();
        addLog(`Error: ${body.error}`);
      }
    } catch (err) {
      addLog(`Cannot reach backend: ${err.message}`);
    }
  }, [addLog]);

  const handleStop = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/browser/stop`, { method: 'POST' });
    } catch (err) {
      addLog(`Stop error: ${err.message}`);
    }
  }, [addLog]);

  const connStatus = socketConnected ? 'connected' : 'disconnected';
  const isActive = browserState === 'running';
  const isStarting = browserState === 'starting';
  const visibleLogs = logs.slice(-7).reverse();

  const statusText = {
    stopped: 'Ready to launch',
    starting: 'Starting Chromium',
    running: 'Interactive session',
    stopping: 'Stopping session',
  }[browserState] || 'Waiting';

  return (
    <div className="app">
      <header className="header">
        <div className="brand-lockup">
          <div className="brand-mark">BLD</div>
          <div>
            <p className="brand-kicker">Remote Browser Control</p>
            <h1 className="brand-title">Chromium Session Console</h1>
          </div>
        </div>

        <Toolbar
          socketRef={socketRef}
          browserState={browserState}
          onStart={handleStart}
          onStop={handleStop}
          currentUrl={currentUrl}
        />

        <div className="conn-badge">
          <div className={`conn-dot ${connStatus}`} />
          <span>{socketConnected ? 'Backend online' : 'Backend offline'}</span>
        </div>
      </header>

      <div className="main-content">
        <aside className="session-panel">
          <div className="panel-section">
            <span className="section-label">Session</span>
            <div className="session-state">
              <div className={`state-orb ${browserState}`} />
              <div>
                <strong>{statusText}</strong>
                <span>{sessionMode ? `${sessionMode} mode` : 'No container attached'}</span>
              </div>
            </div>
          </div>

          <div className="metric-grid">
            <div className="metric-tile">
              <span>FPS</span>
              <strong>{fps ?? '-'}</strong>
            </div>
            <div className="metric-tile">
              <span>Viewport</span>
              <strong>1280 x 720</strong>
            </div>
          </div>

          <div className="panel-section">
            <span className="section-label">Input Routing</span>
            <div className="hint-list">
              <span>Mouse click and movement</span>
              <span>Wheel scrolling</span>
              <span>Keyboard focus on canvas</span>
            </div>
          </div>

          <div className="panel-section recent-events">
            <span className="section-label">Recent Events</span>
            {visibleLogs.length === 0 ? (
              <p className="empty-note">Events will appear after the backend connects.</p>
            ) : (
              visibleLogs.map((entry, i) => (
                <div className="event-row" key={`${entry.time}-${i}`}>
                  <span>{entry.time}</span>
                  <p>{entry.msg}</p>
                </div>
              ))
            )}
          </div>
        </aside>

        <BrowserViewer
          socketRef={socketRef}
          socketConnected={socketConnected}
          isActive={isActive}
          isStarting={isStarting}
          onStart={handleStart}
          logs={startLogs}
        />

        <aside className="log-panel">
          <div className="log-panel-header">
            <span>System Log</span>
            <span>{logs.length} events</span>
          </div>
          <div className="log-panel-body" ref={logBodyRef}>
            {logs.length === 0 && (
              <div className="log-entry">
                <span className="log-entry-msg" style={{ color: 'var(--ink-muted)' }}>
                  No events yet.
                </span>
              </div>
            )}
            {logs.map((entry, i) => (
              <div key={`${entry.time}-${i}`} className="log-entry">
                <span className="log-entry-time">{entry.time}</span>
                <span className="log-entry-msg">{entry.msg}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <StatusBar
        fps={fps}
        socketConnected={socketConnected}
        browserState={browserState}
        sessionMode={sessionMode}
      />
    </div>
  );
}
