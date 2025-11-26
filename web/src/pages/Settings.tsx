import { useEffect, useState } from 'react';
import {
  EmuInfo,
  EmuMountResponse,
  fetchEmus,
  fetchModelStatus,
  mountEmu,
  trainEmu,
  unmountEmu,
  uploadEmu
} from '../api/client';

type ModelStatus = { model: string; available: boolean } | null;

const loadPref = (key: string, fallback: string) => {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
};

const SettingsPage = () => {
  const [apiBase, setApiBase] = useState(() => loadPref('apiBaseOverride', 'http://localhost:4000'));
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState(() =>
    loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions')
  );
  const [openRouterModel, setOpenRouterModel] = useState(() => loadPref('openrouterModel', 'openai/gpt-4o-mini'));
  const [saved, setSaved] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>(null);
  const [emus, setEmus] = useState<EmuInfo[]>([]);
  const [mountedEmus, setMountedEmus] = useState<EmuInfo[]>([]);
  const [emuError, setEmuError] = useState<string | null>(null);
  const [emuBusy, setEmuBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [newEmuId, setNewEmuId] = useState('');
  const [newEmuName, setNewEmuName] = useState('');
  const [newEmuTags, setNewEmuTags] = useState('');
  const [newEmuDescription, setNewEmuDescription] = useState('');
  const [trainingStatus, setTrainingStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchModelStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
    refreshEmus();
  }, []);

  const persist = () => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('apiBaseOverride', apiBase);
    localStorage.setItem('openrouterEndpoint', openRouterEndpoint);
    localStorage.setItem('openrouterModel', openRouterModel);
    setSaved('Saved connection preferences for this browser.');
    setTimeout(() => setSaved(null), 3200);
  };

  const refreshEmus = async () => {
    try {
      const { emus: available, mounted } = await fetchEmus();
      setEmus(available);
      setMountedEmus(mounted);
      setEmuError(null);
      return { available, mounted };
    } catch (err) {
      console.error(err);
      setEmuError('Unable to load EMUs from the backend.');
      return { available: [], mounted: [] };
    }
  };

  const handleMount = async (emuId: string, action: 'mount' | 'unmount') => {
    try {
      setEmuBusy(true);
      const response: EmuMountResponse =
        action === 'mount' ? await mountEmu(emuId) : await unmountEmu(emuId);
      setMountedEmus(response.mounted);
      setEmuError(null);
      return response;
    } catch (err) {
      console.error(err);
      setEmuError('Unable to update EMU mount state.');
      return null;
    } finally {
      setEmuBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setEmuError('Select a document to upload.');
      return;
    }

    try {
      setEmuBusy(true);
      const form = new FormData();
      form.append('file', uploadFile);
      if (newEmuId) form.append('id', newEmuId);
      if (newEmuName) form.append('name', newEmuName);
      if (newEmuDescription) form.append('description', newEmuDescription);
      if (newEmuTags) form.append('tags', newEmuTags);
      await uploadEmu(form);
      setTrainingStatus('Uploaded document and updated EMU index.');
      await refreshEmus();
    } catch (err) {
      console.error(err);
      setEmuError('Unable to upload EMU document.');
    } finally {
      setEmuBusy(false);
    }
  };

  const handleTrain = async (emuId: string) => {
    try {
      setEmuBusy(true);
      setTrainingStatus(`Training ${emuId} via OpenRouter…`);
      const result = await trainEmu(emuId, openRouterModel, openRouterEndpoint);
      setTrainingStatus(`Trained ${emuId} on ${result.document} with ${result.model}.`);
    } catch (err) {
      console.error(err);
      setEmuError('Unable to train EMU with OpenRouter. Check keys and endpoint.');
    } finally {
      setEmuBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local + cloud setup</p>
          <h2>Preferences & technical console</h2>
          <p className="muted">
            Configure endpoints, manage EMUs, and review router health. Everything here keeps the chat surface clutter-free.
          </p>
        </div>
        <div className="status">
          <span className={`badge ${modelStatus?.available ? 'success' : 'warn'}`}>
            {modelStatus?.available ? 'Router healthy' : 'Router offline'}
          </span>
          {modelStatus && <span className="badge ghost">{modelStatus.model}</span>}
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
          <p className="eyebrow">Router state</p>
          <ul className="meta-list">
            <li>
              <span>Model</span>
              <strong>{modelStatus?.model || 'qwen2.5:1.5b-instruct (default)'}</strong>
            </li>
            <li>
              <span>Available</span>
              <strong>{modelStatus?.available ? 'Yes' : 'No'}</strong>
            </li>
            <li>
              <span>Backend</span>
              <strong>{apiBase}</strong>
            </li>
            <li>
              <span>OpenRouter model</span>
              <strong>{openRouterModel}</strong>
            </li>
            <li>
              <span>Overrides</span>
              <strong>apiBaseOverride / openrouter*</strong>
            </li>
          </ul>
        </div>

        <div className="info-card">
          <p className="eyebrow">Command line + router tips</p>
          <ol className="meta-list ordered">
            <li>Install Ollama and keep the daemon running.</li>
            <li>Pull the router: <code>ollama pull qwen2.5:1.5b-instruct</code></li>
            <li>Start backend: <code>npm run dev:server</code></li>
            <li>Start UI: <code>npm run dev:web</code></li>
            <li>Use slash commands in chat: /emus, /mount &lt;id&gt;, /unmount &lt;id&gt;, /reset.</li>
          </ol>
        </div>
      </div>

      {(emuError || trainingStatus) && (
        <div className="info-card warn">
          {emuError && <p className="error">{emuError}</p>}
          {trainingStatus && <p className="muted">{trainingStatus}</p>}
        </div>
      )}

      <div className="emu-board">
        <div className="info-card">
          <div className="emu-card-header">
            <p className="eyebrow">Mounted EMUs</p>
            <button className="ghost" onClick={refreshEmus} disabled={emuBusy}>
              Refresh
            </button>
          </div>
          {mountedEmus.length ? (
            <ul className="meta-list">
              {mountedEmus.map((emu) => (
                <li key={emu.id} className="emu-row">
                  <div>
                    <strong>{emu.name}</strong>
                    <p className="muted">{emu.tags.join(', ') || 'No tags'}</p>
                    {emu.blockVersions && (
                      <p className="muted">{emu.blockVersions.length} versioned blocks</p>
                    )}
                  </div>
                  <div className="emu-actions">
                    <button className="ghost" onClick={() => handleTrain(emu.id)} disabled={emuBusy}>
                      Train
                    </button>
                    <button className="ghost" onClick={() => handleMount(emu.id, 'unmount')} disabled={emuBusy}>
                      Unmount
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No EMUs mounted yet.</p>
          )}
        </div>

        <div className="info-card">
          <div className="emu-card-header">
            <p className="eyebrow">Upload / version EMU</p>
            <span className="badge ghost">Experimental</span>
          </div>
          <div className="upload-grid">
            <label className="muted">
              EMU id
              <input value={newEmuId} onChange={(e) => setNewEmuId(e.target.value)} placeholder="finance-playbook" />
            </label>
            <label className="muted">
              Name
              <input value={newEmuName} onChange={(e) => setNewEmuName(e.target.value)} placeholder="Finance Playbook" />
            </label>
            <label className="muted">
              Tags (comma separated)
              <input value={newEmuTags} onChange={(e) => setNewEmuTags(e.target.value)} placeholder="ops, runbooks" />
            </label>
            <label className="muted">
              Description
              <input
                value={newEmuDescription}
                onChange={(e) => setNewEmuDescription(e.target.value)}
                placeholder="What this EMU captures"
              />
            </label>
            <label className="muted">
              Document
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <button className="ghost" onClick={handleUpload} disabled={emuBusy}>
            Upload and index
          </button>
        </div>
      </div>

      <div className="info-card">
        <div className="emu-card-header">
          <p className="eyebrow">Available EMUs</p>
          <span className="badge ghost">{emus.length}</span>
        </div>
        {emus.length ? (
          <ul className="emu-list">
            {emus.map((emu) => {
              const isMounted = mountedEmus.some((mounted) => mounted.id === emu.id);
              return (
                <li key={emu.id} className="emu-row">
                  <div>
                    <strong>{emu.name}</strong>
                    <p className="muted">{emu.description || 'No description'}</p>
                    <div className="tag-row">
                      {emu.tags.map((tag) => (
                        <span key={tag} className="tag-pill">
                          {tag}
                        </span>
                      ))}
                      {emu.blockVersions && emu.blockVersions.length > 0 && (
                        <span className="badge ghost">{emu.blockVersions.length} blocks</span>
                      )}
                      {emu.benchmarkScore !== undefined && (
                        <span className="badge ghost">Bench {emu.benchmarkScore.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                  <div className="emu-actions">
                    <button
                      className="ghost"
                      onClick={() => handleMount(emu.id, isMounted ? 'unmount' : 'mount')}
                      disabled={emuBusy}
                    >
                      {isMounted ? 'Unmount' : 'Mount'}
                    </button>
                    <button className="ghost" onClick={() => handleTrain(emu.id)} disabled={emuBusy}>
                      Train
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No EMUs discovered yet. Add a folder ending with .emu under the emus/ directory.</p>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
