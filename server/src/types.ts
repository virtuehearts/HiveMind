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

export interface EmuMount {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  path: string;
  blockCount: number;
  sizeBytes?: number;
  lastModified?: string;
}

export type ScrapeJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScrapedChunkRecord {
  url: string;
  file: string;
  bytes: number;
  characters: number;
  approxTokens: number;
}

export interface ScrapeJobArtifacts {
  jobId: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  urls: string[];
  rawDir: string;
  chunks: ScrapedChunkRecord[];
}

export interface UploadChunkArtifacts {
  id: string;
  filename: string;
  mimeType: string;
  createdAt: string;
  rawDir: string;
  chunks: ScrapedChunkRecord[];
}

export interface ScrapeJob {
  id: string;
  name?: string;
  urls: string[];
  status: ScrapeJobStatus;
  createdAt: string;
  updatedAt: string;
  artifacts?: ScrapeJobArtifacts & { buildDir: string; manifestPath: string };
  error?: string;
  warnings?: string[];
}

export type QueryGenerationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface QueryGenerationResult {
  id: string;
  query: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  response?: string;
  filePath?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface QueryGenerationJob {
  id: string;
  model: string;
  prompt: string;
  status: QueryGenerationStatus;
  createdAt: string;
  updatedAt: string;
  total: number;
  completed: number;
  failed: number;
  generatedDir: string;
  items: QueryGenerationResult[];
}

export type EmuBuildStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EmuBuildLog {
  step: string;
  message: string;
  timestamp: string;
}

export interface EmuBuildMetadata {
  id: string;
  name: string;
  trained_by: string;
  trained_at: string;
  approx_tokens: number;
  source_urls: string[];
  query_prompts: string[];
  embedding_model: string;
  chunk_count: number;
  dataset_size_bytes: number;
  notesPath: string;
  lanceDbPath: string;
}

export type EmuBuildStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type EmuBuildStepKey = 'init' | 'embed' | 'package' | 'cleanup';

export interface EmuBuildStep {
  key: EmuBuildStepKey;
  status: EmuBuildStepStatus;
  startedAt?: string;
  finishedAt?: string;
  message?: string;
}

export interface EmuBuildInputs {
  manifestPath: string;
  name?: string;
  trainedBy?: string;
  queryPrompts?: string[];
  signArtifacts?: boolean;
}

export interface EmuBuildArtifacts {
  buildDir: string;
  outputDir?: string;
  archivePath?: string;
  metadataPath?: string;
  signaturePath?: string;
  manifestPath: string;
}

export interface EmuBuildJob {
  id: string;
  name: string;
  status: EmuBuildStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  inputs: EmuBuildInputs;
  steps: EmuBuildStep[];
  artifacts: EmuBuildArtifacts;
  metadata?: EmuBuildMetadata;
  logs: EmuBuildLog[];
  error?: string;
}
