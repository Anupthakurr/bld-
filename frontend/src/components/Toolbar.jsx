import { useCallback, useRef, useState } from 'react';

export default function Toolbar({ socketRef, browserState, onStart, onStop, currentUrl }) {
  const urlInputRef = useRef(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const displayUrl = isEditing ? urlDraft : currentUrl || '';
  const isRunning = browserState === 'running';
  const isStarting = browserState === 'starting';
  const isStopping = browserState === 'stopping';
  const isBusy = isStarting || isStopping;

  const handleNavigate = useCallback((url) => {
    const socket = socketRef.current;
    if (!socket || !isRunning || !url.trim()) return;
    socket.emit('navigate', { url: url.trim() });
    setIsEditing(false);
    urlInputRef.current?.blur();
  }, [socketRef, isRunning]);

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

  const handleBack = () => socketRef.current?.emit('nav:back');
  const handleForward = () => socketRef.current?.emit('nav:forward');
  const handleReload = () => socketRef.current?.emit('nav:reload');

  return (
    <div className="toolbar">
      <div className="nav-cluster" aria-label="Browser navigation">
        <button className="nav-btn" id="nav-back-btn" onClick={handleBack} disabled={!isRunning} title="Back">&lt;</button>
        <button className="nav-btn" id="nav-forward-btn" onClick={handleForward} disabled={!isRunning} title="Forward">&gt;</button>
        <button className="nav-btn" id="nav-reload-btn" onClick={handleReload} disabled={!isRunning} title="Reload">R</button>
      </div>

      <div className="url-bar-wrap">
        <span className="url-lock">http</span>
        <input
          ref={urlInputRef}
          id="url-bar"
          className="url-bar"
          type="text"
          placeholder={isRunning ? 'Enter URL and press Enter' : 'Start browser to navigate'}
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
          Go
        </button>
      </div>

      {browserState === 'stopped' && (
        <button id="start-btn" className="control-btn start" onClick={onStart}>
          Start Browser
        </button>
      )}
      {isBusy && (
        <button className="control-btn loading" disabled>
          <span className="btn-spinner" />
          {isStarting ? 'Starting...' : 'Stopping...'}
        </button>
      )}
      {isRunning && (
        <button id="stop-btn" className="control-btn stop" onClick={onStop}>
          Stop
        </button>
      )}
    </div>
  );
}
