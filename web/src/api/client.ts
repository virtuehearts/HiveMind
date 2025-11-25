export interface RouterDecision {
  intent: string;
  needsContext: boolean;
  tags: string[];
  notes?: string;
}

export interface ChatCompletion {
  reply: string;
  model: string;
  latencyMs?: number;
  tokens?: number;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

export function fetchRouterDecision(message: string) {
  return postJson<RouterDecision>('/api/route', { message });
}

export function fetchChatCompletion(message: string) {
  return postJson<ChatCompletion>('/api/chat', { message });
}

export async function fetchModelStatus() {
  const response = await fetch(`${API_BASE}/api/model`);
  if (!response.ok) {
    throw new Error('Unable to load model status');
  }
  return response.json();
}
