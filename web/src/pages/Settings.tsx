import { useEffect, useState } from 'react';

const SettingsPage = () => {
  const [apiBase, setApiBase] = useState('http://localhost:4000');
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState('https://openrouter.ai/api/v1/chat/completions');
  const [openRouterModel, setOpenRouterModel] = useState('openai/gpt-4o-mini');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    setApiBase(localStorage.getItem('apiBaseOverride') || apiBase);
    setOpenRouterEndpoint(localStorage.getItem('openrouterEndpoint') || openRouterEndpoint);
    setOpenRouterModel(localStorage.getItem('openrouterModel') || openRouterModel);
  }, []);

  const persist = () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('apiBaseOverride', apiBase);
    localStorage.setItem('openrouterEndpoint', openRouterEndpoint);
    localStorage.setItem('openrouterModel', openRouterModel);
    setSaved('Saved connection preferences for this browser.');
    setTimeout(() => setSaved(null), 3200);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local + cloud setup</p>
          <h2>Configure HiveMind endpoints</h2>
          <p className="muted">
            Point the UI at your backend, store OpenRouter model hints, and review how to start the on-device router.
          </p>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-card">
          <p className="eyebrow">Connection</p>
          <label className="muted">
            API base URL
            <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:4000" />
          </label>
          <label className="muted">
            OpenRouter endpoint
            <input
              value={openRouterEndpoint}
              onChange={(e) => setOpenRouterEndpoint(e.target.value)}
              placeholder="https://openrouter.ai/api/v1/chat/completions"
            />
          </label>
          <label className="muted">
            OpenRouter model
            <input value={openRouterModel} onChange={(e) => setOpenRouterModel(e.target.value)} placeholder="openai/gpt-4o-mini" />
          </label>
          <p className="muted small">Store your API key in the backend as OPENROUTER_API_KEY.</p>
          <button className="ghost" onClick={persist}>
            Save for this browser
          </button>
          {saved && <p className="muted">{saved}</p>}
        </div>
        <div className="info-card">
          <p className="eyebrow">Steps</p>
          <ol className="meta-list ordered">
            <li>Install Ollama from ollama.com and ensure the daemon is running.</li>
            <li>Pull the router model: <code>ollama pull qwen2.5:1.5b</code></li>
            <li>Start the backend: <code>npm run dev:server</code></li>
            <li>Start the frontend: <code>npm run dev:web</code> (default at http://localhost:5173)</li>
          </ol>
        </div>
        <div className="info-card">
          <p className="eyebrow">Environment</p>
          <ul className="meta-list">
            <li>
              <span>API base</span>
              <strong>{apiBase}</strong>
            </li>
            <li>
              <span>Router model</span>
              <strong>qwen2.5:1.5b</strong>
            </li>
            <li>
              <span>Cloud model</span>
              <strong>{openRouterModel}</strong>
            </li>
            <li>
              <span>Env override</span>
              <strong>OLLAMA_ROUTER_MODEL / OPENROUTER_MODEL</strong>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
