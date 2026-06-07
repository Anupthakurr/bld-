import { useCallback, useRef, useState } from 'react';

export default function Toolbar({ socket, browserState, onStart, onStop, currentUrl }) {
  const urlInputRef = useRef(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const displayUrl = isEditing ? urlDraft : currentUrl || '';
  const isRunning  = browserState === 'running';
  const isStarting = browserState === 'starting';
  const isStopping = browserState === 'stopping';
  const isBusy     = isStarting || isStopping;

  // ── Navigation handlers ───────────────────────────────────────────────────
  const handleNavigate = useCallback((url) => {
    if (!socket || !isRunning || !url.trim()) return;
    socket.emit('navigate', { url: url.trim() });
    setIsEditing(false);
    urlInputRef.current?.blur();
  }, [socket, isRunning]);

  const handleUrlKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleNavigate(urlDraft);
    if (e.key === 'Escape') {
      setIsEditing(false);
      setUrlDraft(currentUrl || '');
      urlInputRef.current?.blur();
    }
  }, [urlDraft, handleNavigate, currentUrl]);

  const handleUrlFocus = useCallback(() => {
    setIsEditing(true);
    setUrlDraft(currentUrl || '');
    setTimeout(() => urlInputRef.current?.select(), 10);
  }, [currentUrl]);

  const handleBack    = () => socket?.emit('nav:back');
  const handleForward = () => socket?.emit('nav:forward');
  const handleReload  = () => socket?.emit('nav:reload');

  return (
    <div className="toolbar">
      {/* Navigation buttons */}
      <button className="nav-btn" id="nav-back-btn"    onClick={handleBack}    disabled={!isRunning} title="Back">◀</button>
      <button className="nav-btn" id="nav-forward-btn" onClick={handleForward} disabled={!isRunning} title="Forward">▶</button>
      <button className="nav-btn" id="nav-reload-btn"  onClick={handleReload}  disabled={!isRunning} title="Reload">↺</button>

      {/* URL bar */}
      <div className="url-bar-wrap">
        <input
          ref={urlInputRef}
          id="url-bar"
          className="url-bar"
          type="text"
          placeholder={isRunning ? 'Enter URL and press Enter…' : 'Start browser to navigate'}
          value={displayUrl}
          onChange={(e) => setUrlDraft(e.target.value)}
          onFocus={handleUrlFocus}
          onBlur={() => setIsEditing(false)}
          onKeyDown={handleUrlKeyDown}
          disabled={!isRunning}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className="url-go-btn"
          onClick={() => handleNavigate(urlDraft)}
          disabled={!isRunning}
          title="Go"
        >
          ↵
        </button>
      </div>

      {/* Start / Stop button */}
      {(browserState === 'stopped') && (
        <button id="start-btn" className="control-btn start" onClick={onStart}>
          <span>▶</span> Start Browser
        </button>
      )}
      {isBusy && (
        <button className="control-btn loading" disabled>
          <span className="btn-spinner" />
          {isStarting ? 'Starting…' : 'Stopping…'}
        </button>
      )}
      {isRunning && (
        <button id="stop-btn" className="control-btn stop" onClick={onStop}>
          <span>■</span> Stop
        </button>
      )}
    </div>
  );
}
