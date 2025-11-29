import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  QueryGenerationJob,
  QueryGenerationResult,
  createGenerationJob,
  fetchGenerationJob,
  listGenerationJobs
} from '../api/client';
import { loadSecret } from '../utils/secretStorage';

const DEFAULT_MODEL_KEY = 'openrouter.defaultModel';

const statusBadge = (status: QueryGenerationResult['status']) => {
  if (status === 'succeeded') return <span className="badge success">Done</span>;
  if (status === 'failed') return <span className="badge warn">Error</span>;
  if (status === 'running') return <span className="badge ghost">Running</span>;
  return <span className="badge ghost">Pending</span>;
};

const GeneratorPage = () => {
  const [queryText, setQueryText] = useState('');
  const [fileName, setFileName] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [job, setJob] = useState<QueryGenerationJob | null>(null);
  const [jobs, setJobs] = useState<QueryGenerationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedModel = typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MODEL_KEY) : '';
    if (storedModel) setModel(storedModel);

    loadSecret('openrouterApiKey').then((stored) => {
      if (stored) setApiKey(stored);
    });

    listGenerationJobs()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    if (!job) return;
    if (job.status === 'completed' || job.status === 'failed') return;

    const interval = setInterval(async () => {
      try {
        const updated = await fetchGenerationJob(job.id);
        setJob(updated);
        listGenerationJobs().then(setJobs).catch(() => null);
      } catch (err) {
        console.warn('Unable to refresh job', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [job?.id, job?.status]);

  const parsedQueries = useMemo(
    () =>
      queryText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [queryText]
  );

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setQueryText(text);
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!parsedQueries.length) {
      setError('Add at least one query (one per line).');
      return;
    }

    setBusy(true);
    try {
      const nextJob = await createGenerationJob({
        queries: parsedQueries,
        model: model || undefined,
        apiKey: apiKey || undefined,
        prompt: prompt || undefined
      });
      setJob(nextJob);
      setJobs((prev) => [nextJob, ...prev.filter((entry) => entry.id !== nextJob.id)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start generation job';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">OpenRouter</p>
          <h2>Batch query generation</h2>
          <p className="muted">Send a list of queries to your chosen OpenRouter model. Responses are streamed into generated/ as summaries and Q&A.</p>
        </div>
        <div className="status">
          <span className="badge ghost">{jobs.length} jobs</span>
          <span className="badge ghost">{model || 'model from settings'}</span>
        </div>
      </div>

      <form className="info-grid" onSubmit={handleSubmit}>
        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Query list</p>
              <strong>Upload or paste queries</strong>
            </div>
            <label className="pill" style={{ cursor: 'pointer' }}>
              <input type="file" accept=".txt" style={{ display: 'none' }} onChange={handleFile} />
              {fileName ? `Loaded ${fileName}` : 'Load .txt'}
            </label>
          </div>
          <p className="muted small">One query per line. Uploading a text file will replace the current list.</p>
          <textarea
            style={{ minHeight: '200px' }}
            placeholder="Research question, data source, or topic per line"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
          />
          <div className="status" style={{ marginTop: '8px' }}>
            <span className="badge ghost">{parsedQueries.length} queued</span>
            {error && <span className="badge warn">{error}</span>}
          </div>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Model + prompt</p>
              <strong>OpenRouter target</strong>
            </div>
            <span className="badge ghost">streaming</span>
          </div>
          <label>
            Model ID
            <input
              type="text"
              placeholder="Defaults to saved OpenRouter model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            Prompt override
            <textarea
              placeholder="Optional: override the default summary + Q&A prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <label>
            API key
            <input
              type="password"
              placeholder="Use stored OpenRouter key by default"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Starting…' : 'Run batch'}
            </button>
            {job && <span className="badge success">Active: {job.id}</span>}
          </div>
        </div>
      </form>

      {job && (
        <div className="collapse-card">
          <div className="collapse-body">
            <div className="emu-card-header">
              <div>
                <p className="eyebrow">Active job</p>
                <strong>{job.id}</strong>
                <p className="muted small">Status: {job.status}. Files saved under {job.generatedDir}.</p>
              </div>
              <div className="status">
                <span className="badge ghost">{job.completed}/{job.total} done</span>
                {job.failed > 0 && <span className="badge warn">{job.failed} failed</span>}
              </div>
            </div>
            <ul className="emu-list">
              {job.items.map((item) => (
                <li key={item.id} className="emu-row">
                  <div>
                    <strong>{item.query}</strong>
                    <p className="snippet">{item.response ? item.response.slice(0, 180) + (item.response.length > 180 ? '…' : '') : 'Awaiting response'}</p>
                    {item.filePath && (
                      <p className="muted small">Saved to {item.filePath}</p>
                    )}
                    {item.error && <p className="muted" style={{ color: '#fca5a5' }}>{item.error}</p>}
                  </div>
                  <div>{statusBadge(item.status)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="collapse-card">
        <div className="collapse-body">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">History</p>
              <strong>Recent OpenRouter jobs</strong>
            </div>
            <span className="badge ghost">{jobs.length} total</span>
          </div>
          {jobs.length ? (
            <ul className="meta-list ordered">
              {jobs.map((entry) => (
                <li key={entry.id} className="emu-row">
                  <div>
                    <strong>{entry.id}</strong>
                    <p className="muted small">{entry.createdAt}</p>
                    <p className="snippet">{entry.prompt.slice(0, 160)}{entry.prompt.length > 160 ? '…' : ''}</p>
                  </div>
                  <div className="status" style={{ gap: '6px' }}>
                    <span className="badge ghost">{entry.model}</span>
                    <span className="badge ghost">{entry.completed}/{entry.total}</span>
                    {entry.failed > 0 && <span className="badge warn">{entry.failed} failed</span>}
                    <span className="badge ghost">{entry.status}</span>
                    <button className="ghost" onClick={() => setJob(entry)}>View</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No OpenRouter runs yet. Submit a batch above to start collecting Q&A.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneratorPage;
