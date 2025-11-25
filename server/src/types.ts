export interface RouterRequestBody {
  message: string;
  sessionId?: string;
}

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

export interface EmuConfig {
  embeddingModel?: string;
  retriever?: {
    topK?: number;
    keywordWeight?: number;
  };
  chunking?: {
    size?: number;
    overlap?: number;
  };
}

export interface EmuMetadata {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  benchmarkScore?: number;
  notesPath?: string;
}

export interface EmuRecord {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  benchmarkScore?: number;
  path: string;
  notesPath?: string;
  config?: EmuConfig;
}

export interface RetrievalResult {
  emuId: string;
  emuName: string;
  snippet: string;
  score: number;
  source?: string;
}
