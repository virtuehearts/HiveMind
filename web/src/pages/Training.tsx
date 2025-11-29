import { FormEvent, useMemo, useState } from 'react';
import { chunkUpload, UploadChunkArtifacts } from '../api/client';

const promptPresets = [
  { value: 'summaries', label: 'Summaries + key facts', description: 'Generate tight summaries and pull out high-signal facts.' },
  { value: 'qas', label: 'Q&A pairs', description: 'Produce retrieval-friendly Q&A pairs from each chunk.' },
  { value: 'outline', label: 'Section outlines', description: 'Draft outlines with headings, bullets, and topic transitions.' },
  { value: 'custom', label: 'Custom prompt', description: 'Drop in your own prompt to steer enrichment.' }
];

const openRouterModels = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3-haiku',
  'mistralai/mistral-large',
  'google/gemini-1.5-flash'
];

type StepKey = 'ingest' | 'enrich' | 'build' | 'export';

type LogEntry = {
  id: string;
  step: StepKey;
  message: string;
  timestamp: number;
};

const TrainingPage = () => {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [crawlUrl, setCrawlUrl] = useState('');
  const [promptChoice, setPromptChoice] = useState(promptPresets[0].value);
  const [customPrompt, setCustomPrompt] = useState('');
  const [modelChoice, setModelChoice] = useState(openRouterModels[0]);
  const [chunkSize, setChunkSize] = useState(1200);
  const [overlap, setOverlap] = useState(120);
  const [buildTag, setBuildTag] = useState('latest');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [chunkResult, setChunkResult] = useState<UploadChunkArtifacts | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stepStatus, setStepStatus] = useState<Record<StepKey, string>>({
    ingest: 'Pending',
    enrich: 'Queued',
    build: 'Waiting',
    export: 'Waiting'
  });
  const [artifacts, setArtifacts] = useState({
    emuPath: '',
    metadataPath: '',
    updatedAt: 0
  });

  const addLog = (step: StepKey, message: string) => {
    setLogs((prev) => [
      {
        id: crypto.randomUUID(),
        step,
        message,
        timestamp: Date.now()
      },
      ...prev
    ]);
  };

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    setUploadError('');
    setChunkResult(null);

    if (!uploadFile) {
      setUploadError('Attach a PDF or text file to ingest.');
      addLog('ingest', 'Upload blocked: no file attached.');
      return;
    }

    const isPdf = uploadFile.type === 'application/pdf' || uploadFile.name.toLowerCase().endsWith('.pdf');
    const isText = uploadFile.type.startsWith('text/') || /\.(txt|md|markdown)$/i.test(uploadFile.name);

    if (!isPdf && !isText) {
      setUploadError('Only PDF or text uploads are supported right now.');
      addLog('ingest', `Upload blocked: ${uploadFile.name} is not PDF/text.`);
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (ingestTitle.trim()) formData.append('title', ingestTitle.trim());
    if (uploadNotes.trim()) formData.append('notes', uploadNotes.trim());

    setUploading(true);
    setStepStatus((prev) => ({ ...prev, ingest: 'Processing' }));
    addLog('ingest', `Chunking ${uploadFile.name}…`);

    try {
      const result = await chunkUpload(formData);
      setChunkResult(result);
      setStepStatus((prev) => ({ ...prev, ingest: 'Complete', enrich: 'Ready' }));
      addLog('enrich', `Chunks ready (${result.chunks.length} sections, ${result.mimeType}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to chunk upload';
      setUploadError(message);
      setStepStatus((prev) => ({ ...prev, ingest: 'Failed' }));
      addLog('ingest', `Upload failed: ${message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCrawl = (event: FormEvent) => {
    event.preventDefault();
    if (!crawlUrl.trim()) {
      addLog('ingest', 'Enter a URL to crawl before running the collector.');
      return;
    }

    setStepStatus((prev) => ({ ...prev, ingest: 'Crawling' }));
    addLog('ingest', `Crawling ${crawlUrl.trim()} for linked documents and text content.`);
    setTimeout(() => {
      setStepStatus((prev) => ({ ...prev, ingest: 'Complete', enrich: 'Ready' }));
      addLog('ingest', 'Crawler finished. Normalized HTML and PDF assets staged.');
    }, 150);
  };

  const handleBuild = (event: FormEvent) => {
    event.preventDefault();
    setStepStatus((prev) => ({ ...prev, enrich: 'Running', build: 'Packaging' }));
    addLog('enrich', `Applying prompt “${promptPresets.find((p) => p.value === promptChoice)?.label || 'Custom'}” using ${modelChoice}.`);

    const buildLabel = ingestTitle || (uploadFile?.name ?? 'dataset');
    const emuName = `${buildLabel.replace(/[^a-zA-Z0-9-_]+/g, '_').toLowerCase() || 'dataset'}-${buildTag}.emu`;
    const metadataName = `${buildTag}-metadata.json`;

    setTimeout(() => {
      setStepStatus((prev) => ({ ...prev, enrich: 'Complete', build: 'Complete', export: 'Generated' }));
      setArtifacts({
        emuPath: `/artifacts/${emuName}`,
        metadataPath: `/artifacts/${metadataName}`,
        updatedAt: Date.now()
      });
      addLog('build', `Packaged EMU with chunk size ${chunkSize} and ${overlap}px overlap.`);
      addLog('export', `Artifacts saved: ${emuName} and ${metadataName}.`);
    }, 180);
  };

  const stepList: { key: StepKey; label: string; hint: string }[] = [
    { key: 'ingest', label: 'Ingest dataset', hint: 'Upload or crawl sources' },
    { key: 'enrich', label: 'Enrich content', hint: 'Apply prompt presets' },
    { key: 'build', label: 'Build EMU', hint: 'Package embeddings + metadata' },
    { key: 'export', label: 'Publish artifacts', hint: 'EMU + metadata.json' }
  ];

  const formattedUpdated = useMemo(() => {
    if (!artifacts.updatedAt) return '—';
    return new Date(artifacts.updatedAt).toLocaleString();
  }, [artifacts.updatedAt]);

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">EMU Manager</p>
          <h2>Training and packaging</h2>
          <p className="muted">Ingest documents, apply enrichment prompts, and publish EMU bundles via OpenRouter models.</p>
        </div>
        <div className="status">
          <span className="badge success">Online</span>
          <span className="badge ghost">Pipeline draft</span>
        </div>
      </div>

      <div className="hero-banner">
        <div className="hero-copy">
          <p className="eyebrow">Pipeline overview</p>
          <h3>Dataset → Prompt → OpenRouter → EMU</h3>
          <p className="muted">Track ingestion, enrichment, and export steps in one place. Logs stream in as each stage completes.</p>
          <div className="pill-row">
            <span className="pill">PDF + text upload</span>
            <span className="pill">URL crawl</span>
            <span className="pill">Prompt presets</span>
            <span className="pill">OpenRouter models</span>
          </div>
        </div>
        <div className="summary-card">
          <p className="eyebrow">Build status</p>
          <h4 style={{ margin: '6px 0 10px' }}>{formattedUpdated === '—' ? 'Waiting to run build' : 'Artifacts ready'}</h4>
          <ul className="meta-list">
            <li>
              <span>EMU file</span>
              <strong>{artifacts.emuPath || '—'}</strong>
            </li>
            <li>
              <span>Metadata</span>
              <strong>{artifacts.metadataPath || '—'}</strong>
            </li>
            <li>
              <span>Updated</span>
              <strong>{formattedUpdated}</strong>
            </li>
          </ul>
        </div>
      </div>

      <div className="status-strip">
        <div className="status-chip">
          <span className="eyebrow">Dataset label</span>
          <strong>{ingestTitle || uploadFile?.name || 'Not set'}</strong>
          <p className="muted small">Titles are used when naming EMU and metadata artifacts.</p>
        </div>
        <div className="status-chip">
          <span className="eyebrow">Prompt preset</span>
          <strong>{promptPresets.find((p) => p.value === promptChoice)?.label}</strong>
          <p className="muted small">Switch presets to adjust the enrichment pass.</p>
        </div>
        <div className="status-chip">
          <span className="eyebrow">Model (OpenRouter)</span>
          <strong>{modelChoice}</strong>
          <p className="muted small">Inference provider for enrichment + packaging.</p>
        </div>
      </div>

      <div className="info-grid compact">
        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Dataset ingestion</p>
              <strong>Upload PDF or paste text</strong>
            </div>
            <span className="badge ghost">Step 1</span>
          </div>
          <form className="import-grid" onSubmit={handleUpload}>
            <label>
              Title / label
              <input
                type="text"
                placeholder="Internal dataset title"
                value={ingestTitle}
                onChange={(event) => setIngestTitle(event.target.value)}
              />
            </label>
            <label>
              PDF or text file
              <input type="file" accept=".pdf,.txt,.md" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
            </label>
            <label className="full-width">
              Paste raw text (optional)
              <textarea
                placeholder="Paste loose text to seed the EMU build"
                value={uploadNotes}
                onChange={(event) => setUploadNotes(event.target.value)}
                rows={3}
              />
            </label>
            <div className="action-row full-width">
              <button type="submit" disabled={uploading}>
                {uploading ? 'Uploading…' : 'Queue ingestion'}
              </button>
              <button type="button" className="ghost" onClick={() => setUploadNotes('')}>
                Clear text
              </button>
            </div>
            {uploadError && (
              <p className="error" style={{ margin: '0 0 6px' }}>
                {uploadError}
              </p>
            )}
            {chunkResult && (
              <div className="chunk-results full-width">
                <div className="emu-card-header">
                  <div>
                    <p className="eyebrow">Chunk output</p>
                    <strong>
                      {chunkResult.chunks.length} sections saved to {chunkResult.rawDir}
                    </strong>
                    <p className="muted">
                      Files include source metadata (filename + MIME) before the text body.
                    </p>
                  </div>
                  <span className="badge ghost">{chunkResult.mimeType}</span>
                </div>
                <ul className="chunk-list">
                  {chunkResult.chunks.map((chunk) => (
                    <li key={chunk.file} className="chunk-row">
                      <div>
                        <strong>{chunk.file}</strong>
                        <p className="muted small">{chunk.url}</p>
                        <div className="tag-row">
                          <span className="tag-pill">~{chunk.approxTokens} tokens</span>
                          <span className="tag-pill">{chunk.characters} chars</span>
                        </div>
                      </div>
                      <div className="meta-list small" style={{ textAlign: 'right' }}>
                        <span className="muted">{(chunk.bytes / 1024).toFixed(1)} KB</span>
                        <span className="muted">{chunkResult.buildDir}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">URL crawl</p>
              <strong>Pull pages directly</strong>
            </div>
            <span className="badge ghost">Step 1</span>
          </div>
          <form className="import-grid" onSubmit={handleCrawl}>
            <label className="full-width">
              Site or page URL
              <input
                type="url"
                placeholder="https://docs.example.com/guide"
                value={crawlUrl}
                onChange={(event) => setCrawlUrl(event.target.value)}
              />
            </label>
            <div className="action-row full-width">
              <button type="submit">Start crawl</button>
              <button type="button" className="ghost" onClick={() => setCrawlUrl('')}>
                Reset URL
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="info-grid compact">
        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Enrichment</p>
              <strong>Prompt selection</strong>
            </div>
            <span className="badge ghost">Step 2</span>
          </div>
          <div className="detail-grid">
            <label>
              Prompt preset
              <select value={promptChoice} onChange={(event) => setPromptChoice(event.target.value)}>
                {promptPresets.map((prompt) => (
                  <option key={prompt.value} value={prompt.value}>
                    {prompt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chunk size
              <input
                type="number"
                min={400}
                max={3600}
                value={chunkSize}
                onChange={(event) => setChunkSize(Number(event.target.value))}
              />
            </label>
            <label>
              Overlap
              <input
                type="number"
                min={0}
                max={320}
                value={overlap}
                onChange={(event) => setOverlap(Number(event.target.value))}
              />
            </label>
            <label className="full-width">
              Custom prompt (optional)
              <textarea
                placeholder="Add directives to steer the enrichment pass"
                value={customPrompt}
                onChange={(event) => setCustomPrompt(event.target.value)}
                rows={3}
              />
            </label>
          </div>
          <p className="muted small">
            {promptPresets.find((preset) => preset.value === promptChoice)?.description || 'Supply a custom prompt to override defaults.'}
          </p>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Model selection</p>
              <strong>OpenRouter provider</strong>
            </div>
            <span className="badge ghost">Step 3</span>
          </div>
          <div className="detail-grid">
            <label>
              Model
              <select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
                {openRouterModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Build tag
              <input
                type="text"
                value={buildTag}
                onChange={(event) => setBuildTag(event.target.value)}
                placeholder="latest"
              />
            </label>
            <label className="full-width">
              Notes
              <textarea placeholder="Call out routing or privacy constraints for this build" rows={3} />
            </label>
          </div>
          <p className="muted small">OpenRouter config is used for both enrichment and packaging requests.</p>
        </div>
      </div>

      <div className="import-card">
        <div className="emu-card-header">
          <div>
            <p className="eyebrow">Build controls</p>
            <strong>Start an EMU training run</strong>
          </div>
          <span className="badge ghost">Step 4</span>
        </div>
        <form className="action-row" onSubmit={handleBuild}>
          <button type="submit">Build EMU + metadata</button>
          <button type="button" className="ghost" onClick={() => setLogs([])}>
            Clear logs
          </button>
          <p className="muted small">Tracks enrichment, embedding, and artifact export.</p>
        </form>
      </div>

      <div className="info-grid compact">
        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Pipeline status</p>
              <strong>Step tracker</strong>
            </div>
            <span className="badge ghost">Live</span>
          </div>
          <ul className="step-list">
            {stepList.map((step) => (
              <li key={step.key}>
                <div>
                  <span className="eyebrow">{step.label}</span>
                  <p className="muted small">{step.hint}</p>
                </div>
                <span
                  className={`badge ${
                    stepStatus[step.key] === 'Complete' || stepStatus[step.key] === 'Generated'
                      ? 'success'
                      : 'ghost'
                  }`}
                >
                  {stepStatus[step.key]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Per-step logs</p>
              <strong>Recent events</strong>
            </div>
            <span className="badge ghost">Stream</span>
          </div>
          <div className="raw-view">
            <div className="raw-header">
              <strong>Pipeline logs</strong>
              <span className="badge ghost">Newest first</span>
            </div>
            <pre>
              {logs.length === 0
                ? 'No logs yet. Run ingestion or start a build to stream events.'
                : logs
                    .map((entry) => `${new Date(entry.timestamp).toLocaleTimeString()} — [${entry.step}] ${entry.message}`)
                    .join('\n')}
            </pre>
          </div>
        </div>

        <div className="import-card">
          <div className="emu-card-header">
            <div>
              <p className="eyebrow">Artifacts</p>
              <strong>Final outputs</strong>
            </div>
            <span className="badge ghost">Export</span>
          </div>
          <ul className="meta-list ordered">
            <li>
              <div>
                <strong>EMU archive</strong>
                <p className="muted small">Packaged embeddings + source context.</p>
              </div>
              <div className="emu-actions">
                <button className="ghost" type="button" disabled={!artifacts.emuPath}>
                  {artifacts.emuPath ? 'Download' : 'Pending'}
                </button>
              </div>
            </li>
            <li>
              <div>
                <strong>metadata.json</strong>
                <p className="muted small">Chunk stats, model info, and provenance.</p>
              </div>
              <div className="emu-actions">
                <button className="ghost" type="button" disabled={!artifacts.metadataPath}>
                  {artifacts.metadataPath ? 'Download' : 'Pending'}
                </button>
              </div>
            </li>
            <li>
              <div>
                <strong>Activity</strong>
                <p className="muted small">Last updated: {formattedUpdated}</p>
              </div>
              <div className="emu-actions">
                <button className="ghost" type="button" onClick={() => setArtifacts({ emuPath: '', metadataPath: '', updatedAt: 0 })}>
                  Reset
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default TrainingPage;
