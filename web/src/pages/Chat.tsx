import { FormEvent, useEffect, useMemo, useState } from 'react';
import MessageBubble from '../components/MessageBubble';
import {
  ChatCompletion,
  ConversationTurn,
  MemoryBlock,
  MemoryStatus,
  RouterDecision,
  fetchChatCompletion,
  fetchMemoryBlocks,
  fetchMemoryStatus,
  fetchModelStatus,
  fetchRouterDecision,
  createMemoryBlock,
  resolveDefaultApiBase
} from '../api/client';

const makeSessionId = () => Math.random().toString(36).slice(2, 10);

type Message = { role: 'user' | 'assistant'; content: string };
type ModelStatus = { model: string; available: boolean } | null;

type DecisionSnapshot = RouterDecision & { timestamp: number };

const ChatPage = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Local HiveMind is ready. Send a prompt to start chatting.' }
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'routing' | 'chatting'>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>(null);
  const [apiBase] = useState(resolveDefaultApiBase());
  const [decision, setDecision] = useState<DecisionSnapshot | null>(null);
  const [conversationPreview, setConversationPreview] = useState<ConversationTurn[]>([]);
  const [memoryBlocks, setMemoryBlocks] = useState<MemoryBlock[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [memoryBusy, setMemoryBusy] = useState(false);

  const [sessionId, setSessionId] = useState(() => {
    if (typeof localStorage === 'undefined') return makeSessionId();
    const existing = localStorage.getItem('hivemindSessionId');
    if (existing) return existing;
    const next = makeSessionId();
    localStorage.setItem('hivemindSessionId', next);
    return next;
  });

  const regenerateSession = () => {
    const next = makeSessionId();
    setSessionId(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hivemindSessionId', next);
    }
    setMessages([{ role: 'assistant', content: 'Session reset. Start a new local chat.' }]);
    setDecision(null);
    setConversationPreview([]);
  };

  useEffect(() => {
    fetchModelStatus()
      .then(setModelStatus)
      .catch((error) => {
        console.error('Unable to fetch model status', error);
        setModelStatus(null);
      });
  }, []);

  useEffect(() => {
    const loadMemoryLayer = async () => {
      try {
        const [status, blocks] = await Promise.all([fetchMemoryStatus(), fetchMemoryBlocks()]);
        setMemoryStatus(status);
        setMemoryBlocks(blocks);
      } catch (error) {
        console.warn('Memory layer unavailable', error);
      }
    };

    loadMemoryLayer();
  }, []);

  const statusLabel = useMemo(() => {
    if (status === 'routing') return 'Classifying intent…';
    if (status === 'chatting') return 'Responding…';
    return 'Idle';
  }, [status]);

  const formatTimestamp = (iso?: string | null) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return date.toLocaleString();
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    if (modelStatus && !modelStatus.available) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Router unavailable. Start the backend and pull ${modelStatus.model}.` }
      ]);
      return;
    }

    try {
      setStatus('routing');
      const nextDecision = await fetchRouterDecision(trimmed, sessionId);
      const enrichedDecision: DecisionSnapshot = { ...nextDecision, timestamp: Date.now() };
      setDecision(enrichedDecision);

      setStatus('chatting');
      const completion: ChatCompletion = await fetchChatCompletion(
        trimmed,
        sessionId,
        nextDecision.transformedQuery || undefined
      );
      const reply: Message = { role: 'assistant', content: completion.reply };
      setMessages((prev) => [...prev, reply]);
      setConversationPreview(completion.contextUsed || []);
    } catch (err) {
      console.error('Local router error', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Unable to reach the local router at ${apiBase}. Ensure the server is running and Ollama is serving the model.`
        }
      ]);
    } finally {
      setStatus('idle');
    }
  };

  const handleMemorySave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = memoryDraft.trim();
    if (!content || memoryBusy) return;

    setMemoryBusy(true);
    try {
      const block = await createMemoryBlock({
        title: memoryTitle.trim() || undefined,
        content,
        tags: decision?.tags
      });

      setMemoryBlocks((prev) => [block, ...prev]);
      const status = await fetchMemoryStatus();
      setMemoryStatus(status);
      setMemoryDraft('');
      setMemoryTitle('');
    } catch (error) {
      console.error('Unable to persist memory block', error);
    } finally {
      setMemoryBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Local-only</p>
          <h2>Ollama HiveMind chat</h2>
          <p className="muted">Router + chat run on qwen2.5:1.5b-instruct with a 64K local memory.</p>
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
          <span className="eyebrow">Session</span>
          <strong>{sessionId}</strong>
          <button className="ghost" onClick={regenerateSession}>
            Reset
          </button>
        </div>
        <div className="status-chip">
          <span className="eyebrow">State</span>
          <strong>{statusLabel}</strong>
        </div>
        <div className="status-chip">
          <span className="eyebrow">Memory</span>
          <strong>~64K local context</strong>
        </div>
      </div>

      <div className="chat-window">
        {messages.map((message, index) => (
          <MessageBubble key={index} role={message.role} content={message.content} />
        ))}
      </div>

      <div className="collapsible-stack">
        <div className="collapse-card">
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
                  <span>Transformed query</span>
                  <strong>{decision.transformedQuery || '—'}</strong>
                </li>
                <li>
                  <span>Re-ranking</span>
                  <strong>{decision.rerankCriteria || 'None'}</strong>
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
              <p className="muted">Send a prompt to see router output (intent, query rewrite, and re-ranking).</p>
            )}
          </div>
        </div>

        <div className="collapse-card">
          <div className="collapse-body">
            {conversationPreview.length ? (
              <ul className="meta-list ordered">
                {conversationPreview.map((turn, index) => (
                  <li key={`${turn.role}-${index}`} className="emu-row">
                    <div>
                      <strong>{turn.role}</strong>
                      <p className="snippet">{turn.content}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Conversation history will appear here as it is reused.</p>
            )}
          </div>
        </div>

        <div className="collapse-card">
          <div className="collapse-body memory-card">
            <div className="emu-card-header">
              <div>
                <p className="eyebrow">EMU memory layer</p>
                <h3>Personal memories</h3>
                <p className="muted">Save private snippets into local EMU blocks with automatic intent + tags.</p>
              </div>
              <div className="status">
                <span className="badge ghost">
                  {memoryStatus ? `${memoryStatus.totalBlocks} blocks` : 'Memory offline'}
                </span>
                {memoryStatus?.lastUpdated && (
                  <span className="badge ghost small">Updated {formatTimestamp(memoryStatus.lastUpdated)}</span>
                )}
              </div>
            </div>

            <form className="memory-input" onSubmit={handleMemorySave}>
              <input
                placeholder="Memory title (optional)"
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
              />
              <textarea
                placeholder="Add a personal memory block – routines, preferences, schedules, or context you want to keep local."
                value={memoryDraft}
                onChange={(event) => setMemoryDraft(event.target.value)}
              />
              <div className="emu-actions">
                <button type="submit" disabled={memoryBusy || !memoryDraft.trim()}>
                  {memoryBusy ? 'Saving…' : 'Save to EMU memory'}
                </button>
                <span className="muted small">Intent and tags are indexed locally; router chat stays untouched.</span>
              </div>
            </form>

            <div className="status-strip memory-status">
              <div className="status-chip">
                <span className="eyebrow">Storage</span>
                <strong>{memoryStatus?.storagePath || 'local disk'}</strong>
              </div>
              <div className="status-chip">
                <span className="eyebrow">Intents</span>
                <strong>
                  {memoryStatus?.intents?.length
                    ? memoryStatus.intents.map((entry) => `${entry.intent} (${entry.count})`).join(' • ')
                    : 'No index yet'}
                </strong>
              </div>
              <div className="status-chip">
                <span className="eyebrow">Top tags</span>
                <strong>{memoryStatus?.topTags?.length ? memoryStatus.topTags.join(', ') : 'Pending'}</strong>
              </div>
            </div>

            {memoryBlocks.length ? (
              <ul className="emu-list">
                {memoryBlocks.map((block) => (
                  <li key={block.id} className="emu-row">
                    <div>
                      <strong>{block.title}</strong>
                      <p className="snippet">{block.summary}</p>
                      <div className="tag-row">
                        <span className="tag-pill">{block.intent}</span>
                        {block.tags.map((tag) => (
                          <span key={`${block.id}-${tag}`} className="tag-pill">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="meta-list small">
                      <span className="muted">{formatTimestamp(block.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No personal memories stored yet. Add one to test the EMU block index.</p>
            )}
          </div>
        </div>
      </div>

      <form className="chat-input" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message to chat locally"
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
