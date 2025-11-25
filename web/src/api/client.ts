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

export interface EmuInfo {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  benchmarkScore?: number;
  path: string;
  notesPath?: string;
  config?: {
    embeddingModel?: string;
    retriever?: {
      topK?: number;
      keywordWeight?: number;
    };
    chunking?: {
      size?: number;
      overlap?: number;
    };
  };
}

export interface EmuListResponse {
  emus: EmuInfo[];
  mounted: EmuInfo[];
}

export interface EmuMountResponse {
  mounted: EmuInfo[];
  active?: EmuInfo;
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
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

export function fetchEmus() {
  return getJson<EmuListResponse>('/api/emus');
}

export function mountEmu(id: string) {
  return postJson<EmuMountResponse>('/api/emus/mount', { id });
}

export function unmountEmu(id: string) {
  return postJson<EmuMountResponse>('/api/emus/unmount', { id });
}
