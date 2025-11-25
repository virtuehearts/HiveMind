import { Ollama } from 'ollama';
import { config } from '../config';
import { ChatCompletion, RouterDecision } from '../types';

const routerSystemPrompt = `You are the HiveMind local router. Given a user message, decide intent and whether retrieval is needed.
Respond with compact JSON using keys intent, needsContext (true/false), tags (array of short tags), and notes.
Keep responses short and avoid additional commentary.`;

export class OllamaClient {
  private client: Ollama;

  constructor() {
    this.client = new Ollama({ host: config.ollamaHost });
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

  async route(message: string): Promise<RouterDecision> {
    const model = config.routerModel;

    const response = await this.client.chat({
      model,
      messages: [
        { role: 'system', content: routerSystemPrompt },
        { role: 'user', content: message }
      ],
      stream: false
    });

    const content = response.message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return {
        intent: parsed.intent || 'unknown',
        needsContext: Boolean(parsed.needsContext),
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        notes: parsed.notes
      };
    } catch (error) {
      console.warn('Router response not JSON, falling back to defaults', content, error);
      return { intent: 'unknown', needsContext: true, tags: ['general'], notes: content };
    }
  }

  async chat(message: string): Promise<ChatCompletion> {
    const model = config.routerModel;
    const started = Date.now();
    const response = await this.client.chat({
      model,
      messages: [
        { role: 'system', content: 'You are a concise assistant for HiveMind local development.' },
        { role: 'user', content: message }
      ],
      stream: false
    });

    const latencyMs = Date.now() - started;
    return {
      reply: response.message.content,
      model,
      latencyMs
    };
  }
}
