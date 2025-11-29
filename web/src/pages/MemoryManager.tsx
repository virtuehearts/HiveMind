import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  MemoryBlock,
  MemoryBlockUpdate,
  MemoryStatus,
  deleteMemoryBlock,
  exportMemoryBlock,
  fetchMemoryBlocks,
  fetchMemoryStatus,
  importMemoryDocument,
  updateMemoryBlock
} from '../api/client';

const formatTimestamp = (iso?: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString();
};

const formatSize = (size?: number) => {
  if (!size) return 'raw';
  if (size < 1024) return `${size} bytes`;
  const kb = Math.ceil(size / 1024);
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const formatTokens = (size?: number) => {
  if (!size) return '≈ few tokens';
  const tokens = Math.max(1, Math.round(size / 4));
  if (tokens < 1000) return `${tokens} tokens`;
  return `${Math.round(tokens / 100) / 10}k tokens`;
};

const MemoryManagerPage = () => {
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);

  const [draft, setDraft] = useState<MemoryBlockUpdate>({});

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [metadata, existing] = await Promise.all([fetchMemoryStatus(), fetchMemoryBlocks()]);
        setStatus(metadata);
        setBlocks(existing);
        if (existing.length) {
          setSelectedId(existing[0].id);
        }
      } catch (error) {
        console.warn('Unable to load memory manager', error);
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedBlock = useMemo(
    () => blocks.find((entry) => entry.id === selectedId) || null,
    [blocks, selectedId]
  );

  useEffect(() => {
    if (!selectedBlock) return;
    setDraft({
      title: selectedBlock.title,
      tags: selectedBlock.tags,
      labels: selectedBlock.labels,
      notes: selectedBlock.notes,
      genre: selectedBlock.genre,
      isPrivate: selectedBlock.isPrivate,
      relevance: selectedBlock.relevance,
      overallScore: selectedBlock.overallScore
    });
  }, [selectedBlock]);

  const filteredBlocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return blocks;

    return blocks.filter((block) => {
      const haystack = `${block.title} ${block.summary} ${block.tags.join(' ')} ${block.labels?.join(' ')}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [blocks, search]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedBlock || saving) return;

    setSaving(true);
    try {
      const payload: MemoryBlockUpdate = {
        ...draft,
        tags: Array.isArray(draft.tags) ? draft.tags : undefined
      };
      const updated = await updateMemoryBlock(selectedBlock.id, payload);
      setBlocks((prev) => prev.map((block) => (block.id === updated.id ? updated : block)));
      setToast('Metadata updated');
    } catch (error) {
      console.error(error);
      setToast('Unable to save updates');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedBlock) return;
    if (!confirm(`Delete memory block “${selectedBlock.title}”?`)) return;

    try {
      await deleteMemoryBlock(selectedBlock.id);
      setBlocks((prev) => prev.filter((block) => block.id !== selectedBlock.id));
      setSelectedId(null);
      setToast('Memory block removed');
    } catch (error) {
      console.error(error);
      setToast('Unable to delete block');
    }
  };

  const handleExport = async () => {
    if (!selectedBlock) return;
    try {
      const blob = await exportMemoryBlock(selectedBlock.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${selectedBlock.title || selectedBlock.id}.json.gz`;
      link.click();
      window.URL.revokeObjectURL(url);
      setToast('Downloaded block archive');
    } catch (error) {
      console.error(error);
      setToast('Unable to download archive');
    }
  };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!uploadFile) return;

    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      if (uploadTitle.trim()) form.append('title', uploadTitle.trim());
      if (uploadTags.trim()) form.append('tags', uploadTags.trim());

      const block = await importMemoryDocument(form);
      setBlocks((prev) => [block, ...prev]);
      setSelectedId(block.id);
      setUploadFile(null);
      setUploadTitle('');
      setUploadTags('');
      const input = document.getElementById('memory-upload') as HTMLInputElement | null;
      if (input) input.value = '';
      setToast('Imported document into EMU');
    } catch (error) {
      console.error(error);
      setToast('Unable to import document');
    } finally {
      setImporting(false);
    }
  };

  const tokenCount = selectedBlock ? formatTokens(selectedBlock.size || selectedBlock.content.length) : '—';

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">EMU memory layer</p>
          <h2>Memory manager</h2>
          <p className="muted">
            Inspect, edit, and index every memory block across mounted EMUs. Rename, tag, or rate snippets
            before routing them back to the LLM.
          </p>
        </div>
        <div className="status">
          <span className="badge ghost">{status ? `${status.totalBlocks} blocks` : 'Loading…'}</span>
          {status?.lastUpdated && (
            <span className="badge ghost small">Updated {formatTimestamp(status.lastUpdated)}</span>
          )}
        </div>
      </div>

      <div className="manager-grid">
        <div className="manager-sidebar">
          <div className="sidebar-controls">
            <input
              placeholder="Search memories by title, tag, or label"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="status-chip">
              <span className="eyebrow">Storage</span>
              <strong>{status?.storagePath || 'Local disk'}</strong>
            </div>
          </div>

          <ul className="block-list">
            {filteredBlocks.map((block) => (
              <li
                key={block.id}
                className={`block-row ${block.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(block.id)}
              >
                <div>
                  <strong>{block.title}</strong>
                  <p className="snippet">{block.summary}</p>
                  <div className="tag-row">
                    <span className="tag-pill">{block.intent}</span>
                    {block.tags.slice(0, 4).map((tag) => (
                      <span key={`${block.id}-${tag}`} className="tag-pill">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="meta-list small">
                  <span className="muted">{formatTimestamp(block.updatedAt)}</span>
                  <span className="muted">{formatSize(block.size || block.content.length)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="manager-detail">
          {selectedBlock ? (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">{selectedBlock.source}</p>
                  <h3>{selectedBlock.title}</h3>
                  <p className="muted">{selectedBlock.summary}</p>
                </div>
                <div className="status">
                  <span className="badge ghost">{formatSize(selectedBlock.size)}</span>
                  <span className="badge ghost">{tokenCount}</span>
                  {selectedBlock.isPrivate ? (
                    <span className="badge warn">Private</span>
                  ) : (
                    <span className="badge success">Public</span>
                  )}
                </div>
              </div>

              <form className="detail-grid" onSubmit={handleSave}>
                <label>
                  <span className="eyebrow">Title</span>
                  <input
                    value={draft.title || ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </label>

                <label>
                  <span className="eyebrow">Tags</span>
                  <input
                    value={(draft.tags as string[])?.join(', ') || ''}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, tags: event.target.value.split(',').map((tag) => tag.trim()) }))
                    }
                    placeholder="identity, nickname, location"
                  />
                </label>

                <label>
                  <span className="eyebrow">Labels</span>
                  <input
                    value={(draft.labels as string[])?.join(', ') || ''}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, labels: event.target.value.split(',').map((tag) => tag.trim()) }))
                    }
                    placeholder="vector aliases"
                  />
                </label>

                <label>
                  <span className="eyebrow">Genre</span>
                  <input
                    value={draft.genre || ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, genre: event.target.value }))}
                    placeholder="journal, schedule, poetry"
                  />
                </label>

                <label>
                  <span className="eyebrow">Relevance</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={draft.relevance ?? 0}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, relevance: Number(event.target.value) }))
                    }
                  />
                  <small className="muted">{draft.relevance ? `${Math.round((draft.relevance || 0) * 100)}%` : 'Not rated'}</small>
                </label>

                <label>
                  <span className="eyebrow">Overall score</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={draft.overallScore ?? 0}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, overallScore: Number(event.target.value) }))
                    }
                  />
                  <small className="muted">{draft.overallScore ? `${Math.round((draft.overallScore || 0) * 100)}%` : 'Not rated'}</small>
                </label>

                <label className="full-width">
                  <span className="eyebrow">Notes</span>
                  <textarea
                    value={draft.notes || ''}
                    onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Add routing hints, keep track of updates, or jot down why this block matters."
                  />
                </label>

                <div className="switch-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!draft.isPrivate}
                      onChange={(event) => setDraft((prev) => ({ ...prev, isPrivate: event.target.checked }))}
                    />
                    <span>Keep private</span>
                  </label>
                </div>

                <div className="action-row">
                  <button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save metadata'}
                  </button>
                  <button type="button" className="ghost" onClick={handleExport}>
                    Download .gz
                  </button>
                  <button type="button" className="ghost" onClick={handleDelete}>
                    Delete
                  </button>
                </div>
              </form>

              <div className="raw-view">
                <div className="raw-header">
                  <div>
                    <p className="eyebrow">Raw data</p>
                    <p className="muted">{tokenCount} • {selectedBlock.tags.join(', ')}</p>
                  </div>
                </div>
                <pre>{selectedBlock.content}</pre>
              </div>
            </>
          ) : (
            <p className="muted">Select a block to inspect its content and metadata.</p>
          )}
        </div>
      </div>

      <div className="import-card">
        <div>
          <p className="eyebrow">Document ingestion</p>
          <h3>Parse files into EMU blocks</h3>
          <p className="muted">Upload .txt or .pdf files and mount them locally for reranking and vector search.</p>
        </div>

        <form className="import-grid" onSubmit={handleImport}>
          <label>
            <span className="eyebrow">File</span>
            <input
              id="memory-upload"
              type="file"
              accept=".txt,.md,application/pdf"
              onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
            />
          </label>
          <label>
            <span className="eyebrow">Title (optional)</span>
            <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} />
          </label>
          <label>
            <span className="eyebrow">Tags (comma-separated)</span>
            <input value={uploadTags} onChange={(event) => setUploadTags(event.target.value)} />
          </label>

          <div className="action-row">
            <button type="submit" disabled={!uploadFile || importing}>
              {importing ? 'Importing…' : 'Import to EMU'}
            </button>
            <span className="muted small">
              Files stay on disk. We chunk and classify them so you can browse, rename, or zip each block.
            </span>
          </div>
        </form>
      </div>

      {toast && (
        <div className="toast-stack">
          <div className="toast info" role="status">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
};

export default MemoryManagerPage;
