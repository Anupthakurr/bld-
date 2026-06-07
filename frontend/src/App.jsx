import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import BrowserViewer from './components/BrowserViewer.jsx';
import Toolbar from './components/Toolbar.jsx';
import StatusBar from './components/StatusBar.jsx';

const BACKEND_URL = 'http://localhost:3001';

export default function App() {
  const socketRef     = useRef(null);
  const logBodyRef    = useRef(null);

  const [socketConnected, setSocketConnected] = useState(false);
  const [browserState, setBrowserState]       = useState('stopped');
  const [sessionMode, setSessionMode]         = useState(null); // 'docker' | 'local'
  const [currentUrl, setCurrentUrl]           = useState('');
  const [fps, setFps]                         = useState(null);
  const [logs, setLogs]                       = useState([]);
  const [startLogs, setStartLogs]             = useState([]);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    setLogs(prev => [...prev.slice(-199), { msg, time }]);
  }, []);

  // ── Socket.IO setup ───────────────────────────────────────────────────────
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
      addLog(`Browser is live!${mode ? ` (${mode} mode)` : ''}`);
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
      setStartLogs(prev => [...prev.slice(-19), message]);
    });

    return () => socket.disconnect();
  }, [addLog]);

  // Auto-scroll log panel
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [logs]);

  // ── Browser control ───────────────────────────────────────────────────────
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

  const connStatus  = socketConnected ? 'connected' : 'disconnected';
  const isActive    = browserState === 'running';
  const isStarting  = browserState === 'starting';

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <div className="header-logo-icon">🌐</div>
          <span className="header-logo-text">BLD Remote Browser</span>
        </div>

        <div className="header-divider" />

        <Toolbar
          socket={socketRef.current}
          browserState={browserState}
          onStart={handleStart}
          onStop={handleStop}
          currentUrl={currentUrl}
        />

        <div className="header-divider" />

        {/* Connection badge */}
        <div className="conn-badge">
          <div className={`conn-dot ${connStatus}`} />
          <span>{socketConnected ? 'Live' : 'Offline'}</span>
        </div>
      </header>

      {/* Main area */}
      <div className="main-content">
        <BrowserViewer
          socket={socketRef.current}
          isActive={isActive}
          isStarting={isStarting}
          onStart={handleStart}
          logs={startLogs}
        />

        {/* Side log panel */}
        <aside className="log-panel">
          <div className="log-panel-header">System Log</div>
          <div className="log-panel-body" ref={logBodyRef}>
            {logs.length === 0 && (
              <div className="log-entry">
                <span className="log-entry-msg" style={{ color: 'var(--text-muted)' }}>
                  No events yet…
                </span>
              </div>
            )}
            {logs.map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-entry-time">{entry.time}</span>
                <span className="log-entry-msg">{entry.msg}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <StatusBar
        fps={fps}
        socketConnected={socketConnected}
        browserState={browserState}
        sessionMode={sessionMode}
      />
    </div>
  );
}
