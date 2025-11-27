export interface RouterDecision {
  intent: string;
  needsContext: boolean;
  tags: string[];
  notes?: string;
  transformedQuery?: string;
  rerankCriteria?: string;
}

export interface ChatCompletion {
  reply: string;
  model: string;
  latencyMs?: number;
  tokens?: number;
  contextUsed?: ConversationTurn[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function resolveDefaultApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  if (typeof window !== 'undefined') {
    const { origin, hostname, protocol } = window.location;

    const forwarded = origin.match(/^https?:\/\/(\d+)-(.*)$/);
    if (forwarded) {
      return `${protocol}//4000-${forwarded[2]}`;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:4000`;
    }
  }

  return 'http://localhost:4000';
}

const DEFAULT_API_BASE = resolveDefaultApiBase();

function getApiBase() {
  if (typeof localStorage === 'undefined') return DEFAULT_API_BASE;
  const override = localStorage.getItem('apiBaseOverride');
  return override || DEFAULT_API_BASE;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

export function fetchRouterDecision(message: string, sessionId: string) {
  return postJson<RouterDecision>('/api/route', { message, sessionId });
}

export function fetchChatCompletion(message: string, sessionId: string, transformedQuery?: string) {
  return postJson<ChatCompletion>('/api/chat', { message, sessionId, transformedQuery });
}

export async function fetchModelStatus() {
  const response = await fetch(`${getApiBase()}/api/model`);
  if (!response.ok) {
    throw new Error('Unable to load model status');
  }
  return response.json();
}
