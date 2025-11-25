import { FormEvent, useEffect, useState } from 'react';
import MessageBubble from '../components/MessageBubble';
import {
  ChatCompletion,
  EmuInfo,
  EmuMountResponse,
  RouterDecision,
  fetchChatCompletion,
  fetchEmus,
  fetchModelStatus,
  fetchRouterDecision,
  mountEmu,
  unmountEmu
} from '../api/client';

type Message = { role: 'user' | 'assistant'; content: string };

type ModelStatus = { model: string; available: boolean } | null;

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

  useEffect(() => {
    fetchModelStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
    refreshEmus();
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

      setStatus('chatting');
      const completion: ChatCompletion = await fetchChatCompletion(trimmed);
      const reply: Message = { role: 'assistant', content: completion.reply };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      setError('Unable to reach the local router. Make sure Ollama is running with the Qwen 1.5B model.');
    } finally {
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
                  </div>
                  <button className="ghost" onClick={() => handleMount(emu.id, 'unmount')} disabled={emuBusy}>
                    Unmount
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No EMUs mounted. Mount one from the list below.</p>
          )}
          {emuError && <p className="error">{emuError}</p>}
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
    </div>
  );
};

export default ChatPage;
