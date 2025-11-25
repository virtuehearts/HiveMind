import { FormEvent, useEffect, useState } from 'react';
import MessageBubble from '../components/MessageBubble';
import {
  ChatCompletion,
  RouterDecision,
  fetchChatCompletion,
  fetchModelStatus,
  fetchRouterDecision
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

  useEffect(() => {
    fetchModelStatus()
      .then(setModelStatus)
      .catch(() => setModelStatus(null));
  }, []);

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
