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
  unmountEmu
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
  const [apiBase, setApiBase] = useState(import.meta.env.VITE_API_URL || 'http://localhost:4000');
  const [emus, setEmus] = useState<EmuInfo[]>([]);
  const [mountedEmus, setMountedEmus] = useState<EmuInfo[]>([]);
  const [emuError, setEmuError] = useState<string | null>(null);
  const [, setEmuBusy] = useState(false);
  const [retrievals, setRetrievals] = useState<RetrievalResult[]>([]);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterModel, setOpenRouterModel] = useState(() => loadPref('openrouterModel', 'openai/gpt-4o-mini'));
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState(() =>
    loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions')
  );

  useEffect(() => {
    fetchModelStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
    refreshEmus();
  }, []);

  useEffect(() => {
    setOpenRouterModel(loadPref('openrouterModel', 'openai/gpt-4o-mini'));
    setOpenRouterEndpoint(loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions'));
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem('apiBaseOverride');
      if (override) setApiBase(override);
    }
  }, []);

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

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const handled = await handleSlashCommand(trimmed);
    if (handled) return;

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
      return response;
    } catch (err) {
      console.error(err);
      setEmuError('Unable to update EMU mount state.');
      return null;
    } finally {
      setEmuBusy(false);
    }
  };

  const handleSlashCommand = async (command: string) => {
    if (!command.startsWith('/')) return false;

    const [keyword, ...args] = command.split(/\s+/);

    switch (keyword) {
      case '/emus': {
        const { available, mounted } = await refreshEmus();
        const mountedList = mounted.length
          ? mounted.map((emu) => `${emu.name} (${emu.id})`).join(', ')
          : 'none mounted';
        const availableList = available.length
          ? available.map((emu) => `${emu.name} (${emu.tags.join(', ') || 'no tags'})`).join('; ')
          : 'none discovered';
        const reply = `Mounted: ${mountedList}. Available: ${availableList}.`;
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
        return true;
      }
      case '/mount': {
        const target = args[0];
        if (!target) {
          setMessages((prev) => [...prev, { role: 'assistant', content: 'Usage: /mount <emu-id>' }]);
          return true;
        }
        const response = await handleMount(target, 'mount');
        const active = response?.active;
        if (active) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Mounted ${active.name} (${active.id}).`
            }
          ]);
        }
        return true;
      }
      case '/unmount': {
        const target = args[0];
        if (!target) {
          setMessages((prev) => [...prev, { role: 'assistant', content: 'Usage: /unmount <emu-id>' }]);
          return true;
        }
        const response = await handleMount(target, 'unmount');
        if (response) {
          setMessages((prev) => [...prev, { role: 'assistant', content: `Unmounted ${target}.` }]);
        }
        return true;
      }
      case '/reset': {
        setMessages([{ role: 'assistant', content: 'Session reset. Ready for new prompts.' }]);
        setDecision(null);
        setRetrievals([]);
        return true;
      }
      default: {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Unknown command: ${keyword}` }]);
        return true;
      }
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local-first chat</p>
          <h2>HiveMind router</h2>
          <p className="muted">
            Type a message or slash command. Everything else lives in Preferences so this screen stays focused on chatting.
          </p>
        </div>
        <div className="status">
          <span className={`badge ${modelStatus?.available ? 'success' : 'warn'}`}>
            {modelStatus?.available ? 'Model ready' : 'Model unavailable'}
          </span>
          {modelStatus && <span className="badge ghost">{modelStatus.model}</span>}
        </div>
      </div>

      <div className="status-strip">
        <div className="status-chip">
          <span className="eyebrow">Backend</span>
          <strong>{apiBase}</strong>
        </div>
        <div className="status-chip">
          <span className="eyebrow">Router</span>
          <strong>{modelStatus?.model || 'qwen2.5:1.5b (default)'}</strong>
        </div>
        <div className="status-chip">
          <span className="eyebrow">EMUs</span>
          <strong>{mountedEmus.length} mounted / {emus.length} available</strong>
        </div>
        <div className="status-chip">
          <span className="eyebrow">Live status</span>
          <strong>{status === 'idle' ? 'Idle' : status === 'routing' ? 'Routing…' : 'Chatting…'}</strong>
        </div>
      </div>

      {(error || emuError) && (
        <div className="info-card warn">
          {error && <p className="error">{error}</p>}
          {emuError && <p className="error">{emuError}</p>}
        </div>
      )}

      <div className="chat-window">
        {messages.map((message, index) => (
          <MessageBubble key={index} role={message.role} content={message.content} />
        ))}
      </div>

      <div className="info-grid compact">
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
            </ul>
          ) : (
            <p className="muted">Send a message to see router intent and tags.</p>
          )}
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
            <p className="muted">Mount an EMU in Preferences to see context here.</p>
          )}
        </div>
        <div className="info-card">
          <p className="eyebrow">Slash commands</p>
          <ul className="meta-list">
            <li>
              <span>/emus</span>
              <strong>List mounted + available</strong>
            </li>
            <li>
              <span>/mount &lt;emu-id&gt;</span>
              <strong>Attach an EMU</strong>
            </li>
            <li>
              <span>/unmount &lt;emu-id&gt;</span>
              <strong>Detach an EMU</strong>
            </li>
            <li>
              <span>/reset</span>
              <strong>Clear the session</strong>
            </li>
          </ul>
        </div>
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
