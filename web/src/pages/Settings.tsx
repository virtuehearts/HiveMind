import { FormEvent, useEffect, useMemo, useState } from 'react';
import { fetchFreeOpenRouterModels, OpenRouterModel } from '../api/openRouter';
import { clearSecret, loadSecret, saveSecret } from '../utils/secretStorage';

const DEFAULT_MODEL_KEY = 'openrouter.defaultModel';

const SettingsPage = () => {
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const storedModel = typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MODEL_KEY) : null;
    if (storedModel) {
      setDefaultModel(storedModel);
      setCustomModel(storedModel);
    }

    loadSecret('openrouterApiKey').then((stored) => {
      if (stored) {
        setApiKey(stored);
      }
      refreshModels(stored || undefined);
    });
  }, []);

  const refreshModels = async (key?: string) => {
    setLoadingModels(true);
    setError('');
    try {
      const list = await fetchFreeOpenRouterModels(key || apiKey);
      setModels(list);
      if (!defaultModel && list.length) {
        setDefaultModel(list[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach OpenRouter';
      setError(message);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSavedMessage('');
    setError('');

    const trimmedKey = apiKey.trim();
    const chosenModel = (customModel || defaultModel).trim();

    try {
      if (trimmedKey) {
        await saveSecret('openrouterApiKey', trimmedKey);
      } else {
        clearSecret('openrouterApiKey');
      }

      if (chosenModel && typeof localStorage !== 'undefined') {
        localStorage.setItem(DEFAULT_MODEL_KEY, chosenModel);
        setDefaultModel(chosenModel);
        setCustomModel(chosenModel);
      }

      setSavedMessage('Settings saved securely.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save settings';
      setError(message);
    }
  };

  const activeModel = useMemo(() => {
    const trimmedCustom = customModel.trim();
    return trimmedCustom || defaultModel;
  }, [customModel, defaultModel]);

  const selectedFreeModel = useMemo(() => {
    const found = models.find((model) => model.id === defaultModel);
    return found ? defaultModel : '';
  }, [defaultModel, models]);

  const priceLabel = (model: OpenRouterModel) => {
    const prompt = model.pricing?.prompt ?? 0;
    const completion = model.pricing?.completion ?? 0;
    if (prompt === 0 && completion === 0) return '0.0$/M';
    return `$${prompt}/${completion}`;
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>OpenRouter preferences</h2>
          <p className="muted">Store your OpenRouter API key securely and choose a default model for enrichment and chat.</p>
        </div>
        <div className="status">
          {loadingModels ? <span className="badge ghost">Loading models…</span> : <span className="badge ghost">{models.length} free models</span>}
        </div>
      </div>

      <form className="info-grid" onSubmit={handleSave}>
        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">API access</p>
              <strong>OpenRouter API key</strong>
            </div>
            <button type="button" className="ghost" onClick={() => refreshModels()} disabled={loadingModels}>
              Refresh models
            </button>
          </div>
          <p className="muted small">Keys are encrypted locally before being stored.</p>
          <label>
            API key
            <input
              type="password"
              autoComplete="off"
              placeholder="sk-or-v1-..."
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <p className="muted small">Leave blank to remove the stored key.</p>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Model selection</p>
              <strong>Free OpenRouter models</strong>
              <p className="muted small" style={{ margin: 0 }}>
                Pick from the curated free list without dumping the whole catalog.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="badge ghost">max_price=0</span>
              <button type="button" className="ghost" onClick={() => refreshModels()} disabled={loadingModels}>
                Refresh list
              </button>
            </div>
          </div>
          <label style={{ marginTop: '8px', display: 'block' }}>
            Free model
            <select
              value={selectedFreeModel}
              onChange={(event) => {
                setDefaultModel(event.target.value);
                setCustomModel('');
              }}
              disabled={!models.length}
            >
              <option value="" disabled>
                {loadingModels ? 'Loading…' : 'Select a free model'}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {`${model.name || model.id} (${priceLabel(model)})`}
                </option>
              ))}
            </select>
          </label>
          {!models.length && !loadingModels && (
            <p className="muted small">No free models returned. Enter a custom model below.</p>
          )}
          {error && <p className="muted" style={{ color: '#fca5a5' }}>{error}</p>}
          <p className="muted small" style={{ marginTop: '8px' }}>
            View all models at <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">openrouter.ai/models</a>.
          </p>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Custom or paid model</p>
              <strong>Manual model entry</strong>
            </div>
            <span className="badge ghost">Override</span>
          </div>
          <p className="muted small">Use this when targeting paid or private models not listed above.</p>
          <label>
            Model ID
            <input
              type="text"
              placeholder="e.g. openai/gpt-4o or mistralai/mistral-large"
              value={customModel}
              onChange={(event) => setCustomModel(event.target.value)}
            />
          </label>
          <p className="muted small">This value will be used as the default when provided.</p>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Defaults</p>
              <strong>Active configuration</strong>
            </div>
          </div>
          <ul className="meta-list">
            <li>
              <span>Default model</span>
              <strong>{activeModel || 'Not set'}</strong>
            </li>
            <li>
              <span>API key</span>
              <strong>{apiKey ? 'Encrypted locally' : 'Not stored'}</strong>
            </li>
          </ul>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' }}>
            <button type="submit" className="primary">Save settings</button>
            {savedMessage && <span className="badge success">{savedMessage}</span>}
          </div>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
