import { FormEvent, useEffect, useState } from 'react';
import MessageBubble from '../components/MessageBubble';
import {
  ChatCompletion,
  EmuInfo,
  EmuMountResponse,
  RouterDecision,
  RetrievalResult,
  fetchChatCompletion,
  fetchEmus,
  fetchModelStatus,
  fetchOpenRouterChat,
  fetchRouterDecision,
  fetchRetrieval,
  mountEmu,
  trainEmu,
  unmountEmu,
  uploadEmu
} from '../api/client';

type Message = { role: 'user' | 'assistant'; content: string };

type ModelStatus = { model: string; available: boolean } | null;

const loadPref = (key: string, fallback: string) => {
  if (typeof localStorage === 'undefined') return fallback;
  return localStorage.getItem(key) || fallback;
};

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I am the local HiveMind router using Qwen 1.5B.' }
  ]);
  const [input, setInput] = useState('');
  const [decision, setDecision] = useState<RouterDecision | null>(null);
  const [status, setStatus] = useState<'idle' | 'routing' | 'chatting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>(null);
  const [emus, setEmus] = useState<EmuInfo[]>([]);
  const [mountedEmus, setMountedEmus] = useState<EmuInfo[]>([]);
  const [emuError, setEmuError] = useState<string | null>(null);
  const [emuBusy, setEmuBusy] = useState(false);
  const [retrievals, setRetrievals] = useState<RetrievalResult[]>([]);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterModel, setOpenRouterModel] = useState(() => loadPref('openrouterModel', 'openai/gpt-4o-mini'));
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState(() =>
    loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions')
  );
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

  useEffect(() => {
    setOpenRouterModel(loadPref('openrouterModel', 'openai/gpt-4o-mini'));
    setOpenRouterEndpoint(loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions'));
  }, []);

  const refreshEmus = async () => {
    try {
      const { emus: available, mounted } = await fetchEmus();
      setEmus(available);
      setMountedEmus(mounted);
      setEmuError(null);
    } catch (err) {
      console.error(err);
      setEmuError('Unable to load EMUs from the backend.');
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      setStatus('routing');
      const nextDecision = await fetchRouterDecision(trimmed);
      setDecision(nextDecision);

      let context: RetrievalResult[] = [];
      if (nextDecision.needsContext) {
        const { results } = await fetchRetrieval(trimmed, 4);
        context = results;
        setRetrievals(results);
      } else {
        setRetrievals([]);
      }

      setStatus('chatting');
      const completion: ChatCompletion = await fetchChatCompletion(trimmed);
      const reply: Message = { role: 'assistant', content: completion.reply };
      setMessages((prev) => [...prev, reply]);

      if (completion.contextUsed?.length) {
        setRetrievals(completion.contextUsed);
      } else if (context.length) {
        setRetrievals(context);
      }
    } catch (err) {
      setError('Unable to reach the local router. Make sure Ollama is running with the Qwen 1.5B model.');
    } finally {
      setStatus('idle');
    }
  };

  const handleOpenRouter = async (mode: 'openrouter' | 'sota') => {
    setError(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      setStatus('routing');
      const nextDecision = await fetchRouterDecision(trimmed);
      setDecision(nextDecision);
      const { results } = await fetchRetrieval(trimmed, 6);
      setRetrievals(results);

      setOpenRouterBusy(true);
      setStatus('chatting');
      const completion = await fetchOpenRouterChat(trimmed, openRouterModel, openRouterEndpoint);
      const reply: Message = {
        role: 'assistant',
        content:
          mode === 'sota'
            ? `SOTA (OpenRouter ${completion.model}): ${completion.reply}`
            : `OpenRouter (${completion.model}): ${completion.reply}`
      };
      setMessages((prev) => [...prev, reply]);
      if (completion.contextUsed) {
        setRetrievals(completion.contextUsed);
      }
    } catch (err) {
      console.error(err);
      setError('Unable to reach OpenRouter or orchestrate EMU context.');
    } finally {
      setOpenRouterBusy(false);
      setStatus('idle');
    }
  };

  const handleMount = async (emuId: string, action: 'mount' | 'unmount') => {
    try {
      setEmuBusy(true);
      const response: EmuMountResponse =
        action === 'mount' ? await mountEmu(emuId) : await unmountEmu(emuId);
      setMountedEmus(response.mounted);
      if (response.active && !decision) {
        setDecision({ intent: 'mount', needsContext: true, tags: response.active.tags });
      }
      setEmuError(null);
    } catch (err) {
      console.error(err);
      setEmuError('Unable to update EMU mount state.');
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
          <p className="eyebrow">Local router</p>
          <h2>Qwen 1.5B via Ollama</h2>
          <p className="muted">Routes chat messages locally before escalating to retrieval or cloud models.</p>
        </div>
        <div className="status">
          <span className={`badge ${modelStatus?.available ? 'success' : 'warn'}`}>
            {modelStatus?.available ? 'Model ready' : 'Model unavailable'}
          </span>
          {modelStatus && <span className="badge ghost">{modelStatus.model}</span>}
        </div>
      </div>

      <div className="info-grid">
        <div className="info-card">
          <p className="eyebrow">Router decision</p>
          {decision ? (
            <ul className="meta-list">
              <li>
                <span>Intent</span>
                <strong>{decision.intent}</strong>
              </li>
              <li>
                <span>Needs context</span>
                <strong>{decision.needsContext ? 'Yes' : 'No'}</strong>
              </li>
              <li>
                <span>Tags</span>
                <strong>{decision.tags.join(', ') || 'none'}</strong>
              </li>
              {decision.notes && (
                <li>
                  <span>Notes</span>
                  <strong>{decision.notes}</strong>
                </li>
              )}
            </ul>
          ) : (
            <p className="muted">Send a message to see router intent and tags.</p>
          )}
        </div>
        <div className="info-card">
          <p className="eyebrow">Live status</p>
          <p className="muted">{status === 'idle' ? 'Idle' : status === 'routing' ? 'Routing…' : 'Chatting…'}</p>
          {error && <p className="error">{error}</p>}
        </div>
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
            <p className="muted">No EMUs mounted. Mount one from the list below.</p>
          )}
          {trainingStatus && <p className="muted">{trainingStatus}</p>}
          {emuError && <p className="error">{emuError}</p>}
        </div>
        <div className="info-card">
          <p className="eyebrow">Context preview</p>
          {retrievals.length ? (
            <ul className="meta-list ordered">
              {retrievals.map((hit, index) => (
                <li key={`${hit.emuId}-${index}`} className="emu-row">
                  <div>
                    <strong>{hit.emuName}</strong>
                    <p className="muted">Score {hit.score.toFixed(2)}</p>
                    <p className="snippet">{hit.snippet}</p>
                  </div>
                  {hit.source && <span className="badge ghost">{hit.source}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No context retrieved yet. Mount an EMU and ask a question that needs references.</p>
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

      <div className="chat-window">
        {messages.map((message, index) => (
          <MessageBubble key={index} role={message.role} content={message.content} />
        ))}
      </div>

      <form className="chat-input" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message or try /mount poetry.emu"
          disabled={status !== 'idle'}
        />
        <button type="submit" disabled={status !== 'idle'}>
          {status === 'routing' || status === 'chatting' ? 'Working…' : 'Send'}
        </button>
      </form>

      <div className="chat-actions">
        <button onClick={() => handleOpenRouter('openrouter')} disabled={openRouterBusy || status !== 'idle'}>
          Use OpenRouter
        </button>
        <button onClick={() => handleOpenRouter('sota')} disabled={openRouterBusy || status !== 'idle'}>
          Use SOTA pipeline
        </button>
        <div className="muted small">
          Using model <strong>{openRouterModel}</strong> via <code>{openRouterEndpoint}</code>
        </div>
      </div>
    </div>
  );
};

export default ChatPage;
