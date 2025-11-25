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
  contextUsed?: RetrievalResult[];
}

export interface EmuInfo {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  benchmarkScore?: number;
  path: string;
  notesPath?: string;
  blockVersions?: EmuBlockVersion[];
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

export interface EmuBlockVersion {
  id: string;
  file: string;
  version: number;
  updatedAt: string;
  summary?: string;
}

export interface EmuListResponse {
  emus: EmuInfo[];
  mounted: EmuInfo[];
}

export interface EmuMountResponse {
  mounted: EmuInfo[];
  active?: EmuInfo;
}

export interface RetrievalResult {
  emuId: string;
  emuName: string;
  snippet: string;
  score: number;
  source?: string;
}

export interface RetrievalResponse {
  results: RetrievalResult[];
}

export interface EmuDownload {
  emu: EmuInfo;
  notes?: string;
  documents: { file: string; size: number }[];
}

export interface OpenRouterResponse extends ChatCompletion {
  contextUsed?: RetrievalResult[];
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`);
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

export function fetchRetrieval(message: string, topK?: number) {
  return postJson<RetrievalResponse>('/api/retrieve', { message, topK });
}

export async function fetchModelStatus() {
  const response = await fetch(`${getApiBase()}/api/model`);
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

export function uploadEmu(formData: FormData) {
  return fetch(`${getApiBase()}/api/emus/upload`, {
    method: 'POST',
    body: formData
  }).then((resp) => {
    if (!resp.ok) throw new Error('Upload failed');
    return resp.json();
  });
}

export function downloadEmu(id: string) {
  return getJson<EmuDownload>(`/api/emus/${id}/download`);
}

export function trainEmu(id: string, model?: string, endpoint?: string) {
  return postJson<{ summary: string; model: string; document: string }>(`/api/emus/${id}/train`, { model, endpoint });
}

export function fetchOpenRouterChat(message: string, model?: string, endpoint?: string) {
  return postJson<OpenRouterResponse>('/api/chat/openrouter', { message, model, endpoint });
}
