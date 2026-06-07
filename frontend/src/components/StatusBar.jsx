export default function StatusBar({ fps, socketConnected, browserState, frameLatency }) {
  const stateColor = {
    stopped:  'var(--text-muted)',
    starting: 'var(--warning)',
    running:  'var(--success)',
    stopping: 'var(--danger)',
  }[browserState] || 'var(--text-muted)';

  const stateLabel = {
    stopped:  'Idle',
    starting: 'Starting…',
    running:  'Live',
    stopping: 'Stopping…',
  }[browserState] || 'Unknown';

  return (
    <div className="status-bar">
      <div className="status-item">
        <span>Browser</span>
        <span style={{ color: stateColor, fontWeight: 600 }}>{stateLabel}</span>
      </div>

      <div className="status-sep" />

      {browserState === 'running' && (
        <>
          <div className="status-item">
            <span>FPS</span>
            <span>{fps ?? '–'}</span>
          </div>
          <div className="status-sep" />
          <div className="status-item">
            <span>Viewport</span>
            <span>1280 × 720</span>
          </div>
          <div className="status-sep" />
        </>
      )}

      <div className="status-spacer" />

      <div className="status-item">
        <span>Socket</span>
        <span style={{ color: socketConnected ? 'var(--success)' : 'var(--danger)' }}>
          {socketConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="status-sep" />

      <div className="status-item">
        <span>BLD Remote Browser</span>
        <span>v1.0</span>
      </div>
    </div>
  );
}
