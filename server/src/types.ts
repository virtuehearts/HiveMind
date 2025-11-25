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
