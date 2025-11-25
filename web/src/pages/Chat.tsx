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
  const [modelStatus, setModelStatus] = useState<ModelStatus>(null);
  const [apiBase, setApiBase] = useState(import.meta.env.VITE_API_URL || 'http://localhost:4000');
  const [emus, setEmus] = useState<EmuInfo[]>([]);
  const [mountedEmus, setMountedEmus] = useState<EmuInfo[]>([]);
  const [, setEmuBusy] = useState(false);
  const [retrievals, setRetrievals] = useState<RetrievalResult[]>([]);
  const [openRouterBusy, setOpenRouterBusy] = useState(false);
  const [openRouterModel, setOpenRouterModel] = useState(() => loadPref('openrouterModel', 'openai/gpt-4o-mini'));
  const [openRouterEndpoint, setOpenRouterEndpoint] = useState(() =>
    loadPref('openrouterEndpoint', 'https://openrouter.ai/api/v1/chat/completions')
  );
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: 'info' | 'error' }[]>([]);
  const [collapsedSections, setCollapsedSections] = useState({
    decision: true,
    context: true,
    commands: true
  });

  const pushToast = (message: string, tone: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3800);
  };

  const toggleSection = (key: 'decision' | 'context' | 'commands') => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
      return { available, mounted };
    } catch (err) {
      console.error(err);
      pushToast('Unable to load EMUs from the backend.', 'error');
      return { available: [], mounted: [] };
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      pushToast('Unable to reach the local router. Make sure Ollama is running with the Qwen 1.5B model.', 'error');
    } finally {
      setStatus('idle');
    }
  };

  const handleOpenRouter = async (mode: 'openrouter' | 'sota') => {
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
      pushToast('Unable to reach OpenRouter or orchestrate EMU context.', 'error');
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
      return response;
    } catch (err) {
      console.error(err);
      pushToast('Unable to update EMU mount state.', 'error');
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
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>

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

      <div className="hero-banner">
        <div className="hero-copy">
          <p className="eyebrow">Main interface</p>
          <h3>Route prompts, preview context, and mount EMUs without leaving this screen.</h3>
          <p className="muted">
            Keep the router online, mount EMUs you want to use, and send prompts directly from the unified cockpit.
          </p>
          <div className="pill-row">
            <span className="pill">/emus to list</span>
            <span className="pill">/mount &lt;id&gt;</span>
            <span className="pill">/reset to clear</span>
            <span className="pill">OpenRouter fallback</span>
          </div>
        </div>
        <div className="hero-summary">
          <div className="summary-card">
            <p className="eyebrow">Readiness</p>
            <ul className="meta-list">
              <li>
                <span>Backend</span>
                <strong>{apiBase}</strong>
              </li>
              <li>
                <span>Router</span>
                <strong>{modelStatus?.model || 'qwen2.5:1.5b (default)'}</strong>
              </li>
              <li>
                <span>Model state</span>
                <strong>{modelStatus?.available ? 'Online' : 'Offline'}</strong>
              </li>
              <li>
                <span>Mounted EMUs</span>
                <strong>{mountedEmus.length || 'None yet'}</strong>
              </li>
            </ul>
          </div>
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

      <div className="chat-window">
        {messages.map((message, index) => (
          <MessageBubble key={index} role={message.role} content={message.content} />
        ))}
      </div>

      <div className="collapsible-stack">
        <div className={`collapse-card ${collapsedSections.decision ? 'collapsed' : ''}`}>
          <button className="collapse-toggle" type="button" onClick={() => toggleSection('decision')}>
            <div>
              <p className="eyebrow">Router decision</p>
              <strong>Intent, context need, and tags</strong>
            </div>
            <span className="chevron">{collapsedSections.decision ? '⌄' : '⌃'}</span>
          </button>
          {!collapsedSections.decision && (
            <div className="collapse-body">
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
          )}
        </div>

        <div className={`collapse-card ${collapsedSections.context ? 'collapsed' : ''}`}>
          <button className="collapse-toggle" type="button" onClick={() => toggleSection('context')}>
            <div>
              <p className="eyebrow">Context preview</p>
              <strong>What the EMUs returned</strong>
            </div>
            <span className="chevron">{collapsedSections.context ? '⌄' : '⌃'}</span>
          </button>
          {!collapsedSections.context && (
            <div className="collapse-body">
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
          )}
        </div>

        <div className={`collapse-card ${collapsedSections.commands ? 'collapsed' : ''}`}>
          <button className="collapse-toggle" type="button" onClick={() => toggleSection('commands')}>
            <div>
              <p className="eyebrow">Slash commands</p>
              <strong>Quick actions that work anywhere</strong>
            </div>
            <span className="chevron">{collapsedSections.commands ? '⌄' : '⌃'}</span>
          </button>
          {!collapsedSections.commands && (
            <div className="collapse-body">
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
          )}
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
