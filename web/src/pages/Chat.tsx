import { FormEvent, useEffect, useMemo, useState } from 'react';
import MessageBubble from '../components/MessageBubble';
import {
  ChatCompletion,
  ConversationTurn,
  RouterDecision,
  fetchChatCompletion,
  fetchModelStatus,
  fetchRouterDecision,
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

  const statusLabel = useMemo(() => {
    if (status === 'routing') return 'Classifying intent…';
    if (status === 'chatting') return 'Responding…';
    return 'Idle';
  }, [status]);

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
