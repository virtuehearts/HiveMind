const SettingsPage = () => {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local model setup</p>
          <h2>Run Qwen 2.5 1.5B for routing</h2>
          <p className="muted">
            Start Ollama locally with the Qwen 1.5B model to power the on-device router and quick chat responses.
          </p>
        </div>
      </div>

      <div className="info-grid">
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
              <strong>http://localhost:4000</strong>
            </li>
            <li>
              <span>Router model</span>
              <strong>qwen2.5:1.5b</strong>
            </li>
            <li>
              <span>Env override</span>
              <strong>OLLAMA_ROUTER_MODEL</strong>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
