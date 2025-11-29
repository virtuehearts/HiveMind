export interface RouterRequestBody {
  message: string;
  sessionId?: string;
  intent?: string;
  tags?: string[];
}

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
  memoryBlocks?: MemoryBlock[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface NewMemoryBlockPayload {
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
  labels?: string[];
  notes?: string;
  genre?: string;
  isPrivate?: boolean;
  relevance?: number;
  overallScore?: number;
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
  size?: number;
  labels?: string[];
  notes?: string;
  genre?: string;
  isPrivate?: boolean;
  relevance?: number;
  overallScore?: number;
}

export type MemoryBlockUpdatePayload = Partial<
  Pick<
    MemoryBlock,
    'title' | 'tags' | 'labels' | 'notes' | 'genre' | 'isPrivate' | 'relevance' | 'overallScore'
  >
>;

export interface MemoryIndex {
  byIntent: Record<string, string[]>;
  byTag: Record<string, string[]>;
}

export interface MemoryStatus {
  totalBlocks: number;
  intents: { intent: string; count: number }[];
  topTags: string[];
  storagePath: string;
  lastUpdated: string | null;
  index: MemoryIndex;
}
