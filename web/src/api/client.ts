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

export interface MemoryBlock {
  id: string;
  title: string;
  content: string;
  intent: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  summary: string;
  score: number;
}

export interface MemoryStatus {
  totalBlocks: number;
  intents: { intent: string; count: number }[];
  topTags: string[];
  storagePath: string;
  lastUpdated: string | null;
}

export function resolveDefaultApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  if (typeof window !== 'undefined') {
    const { origin, hostname, protocol } = window.location;

    const forwarded = origin.match(/^https?:\/\/(\d+)-(.*)$/);
    if (forwarded) {
      return `${protocol}//4000-${forwarded[2]}`;
    }

    // GitHub Codespaces and similar environments use domain-based port forwarding
    // with the port embedded as the final "-####" segment of the hostname.
    // Example: https://my-space-5173.app.github.dev -> https://my-space-4000.app.github.dev
    const subdomainPortMatch = hostname.match(/^(.*-)(\d+)(\..*)$/);
    if (subdomainPortMatch) {
      return `${protocol}//${subdomainPortMatch[1]}4000${subdomainPortMatch[3]}`;
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`);
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

export function fetchMemoryStatus() {
  return getJson<MemoryStatus>('/api/memory/status');
}

export function fetchMemoryBlocks() {
  return getJson<MemoryBlock[]>('/api/memory/blocks');
}

export function createMemoryBlock(payload: { title?: string; content: string; tags?: string[] }) {
  return postJson<MemoryBlock>('/api/memory/blocks', payload);
}

export async function fetchModelStatus() {
  const response = await fetch(`${getApiBase()}/api/model`);
  if (!response.ok) {
    throw new Error('Unable to load model status');
  }
  return response.json();
}
