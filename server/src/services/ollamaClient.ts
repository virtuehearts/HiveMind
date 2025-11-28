import { Ollama } from 'ollama';
import { config } from '../config';
import { ChatCompletion, ConversationTurn, MemoryBlock, RouterDecision } from '../types';
import { chatSystemPrompt, routerSystemPrompt } from './prompts';

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OllamaClient {
  private client: Ollama;
  private histories = new Map<string, ConversationTurn[]>();

  constructor() {
    this.client = new Ollama({ host: config.ollamaHost });
  }

  getHistory(sessionId: string): ConversationTurn[] {
    return this.histories.get(sessionId) || [];
  }

  async checkModelAvailability(model: string): Promise<boolean> {
    try {
      const models = await this.client.list();
      return models.models.some((entry) => entry.model === model || entry.name === model);
    } catch (error) {
      console.error('Unable to list Ollama models', error);
      return false;
    }
  }

  async route(message: string, history: ConversationTurn[] = []): Promise<RouterDecision> {
    const model = config.routerModel;
    const historyPreview = history
      .slice(-4)
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');

    const routingMessages: OllamaChatMessage[] = [
      { role: 'system', content: routerSystemPrompt },
      historyPreview ? { role: 'user', content: `Conversation so far:\n${historyPreview}` } : undefined,
      { role: 'user', content: message }
    ].filter(Boolean) as OllamaChatMessage[];

    const response = await this.client.chat({
      model,
      messages: routingMessages,
      stream: false
    });

    const content = response.message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return {
        intent: parsed.intent || 'unknown',
        needsContext: Boolean(parsed.needsContext),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        notes: parsed.notes,
        transformedQuery: parsed.transformedQuery,
        rerankCriteria: parsed.rerankCriteria
      };
    } catch (error) {
      console.warn('Router response not JSON, falling back to defaults', content, error);
      return {
        intent: 'unknown',
        needsContext: history.length > 0,
        tags: ['general'],
        notes: content,
        transformedQuery: message,
        rerankCriteria: history.length ? 'Used recent conversation as context.' : 'none'
      };
    }
  }

  async chat(
    message: string,
    sessionId = 'default',
    transformedQuery?: string,
    memoryContext?: string,
    memoryBlocks?: MemoryBlock[]
  ): Promise<ChatCompletion> {
    const model = config.routerModel;
    const started = Date.now();
    const history = this.histories.get(sessionId) || [];

    const userMessage: ConversationTurn = {
      role: 'user',
      content: transformedQuery || message
    };

    const historyMessages: ConversationTurn[] = [...history, userMessage];
    this.histories.set(sessionId, historyMessages);
    this.trimHistory(sessionId);

    const systemContent = memoryContext
      ? `${chatSystemPrompt}\n\nLocal EMU memory blocks:\n${memoryContext}\nUse them when relevant.\n` 
      : chatSystemPrompt;

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemContent },
      ...this.histories.get(sessionId)!.map((turn) => ({ role: turn.role, content: turn.content }))
    ];

    const response = await this.client.chat({
      model,
      messages,
      stream: false
    });

    const replyContent = response.message.content;
    const assistantTurn: ConversationTurn = { role: 'assistant', content: replyContent };
    const updatedHistory = [...this.histories.get(sessionId)!, assistantTurn];
    this.histories.set(sessionId, updatedHistory);
    this.trimHistory(sessionId);

    const latencyMs = Date.now() - started;
    return {
      reply: replyContent,
      model,
      latencyMs,
      contextUsed: this.histories.get(sessionId),
      memoryBlocks
    };
  }

  private trimHistory(sessionId: string) {
    const history = this.histories.get(sessionId);
    if (!history) return;

    const charLimit = config.maxContextCharacters;
    let totalChars = history.reduce((sum, turn) => sum + turn.content.length, 0);

    while (totalChars > charLimit && history.length > 2) {
      const removed = history.shift();
      totalChars -= removed?.content.length || 0;
    }

    this.histories.set(sessionId, history);
  }
}
