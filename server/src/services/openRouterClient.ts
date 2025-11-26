import { config } from '../config';
import { ChatCompletion, RetrievalResult } from '../types';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string | undefined = config.openRouterApiKey,
    private readonly endpoint: string = config.openRouterEndpoint,
    private readonly defaultModel: string = config.openRouterModel
  ) {}

  hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  private ensureKey() {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured. Set OPENROUTER_API_KEY.');
    }
  }

  async chatWithContext(
    message: string,
    context: RetrievalResult[],
    model?: string,
    endpointOverride?: string
  ): Promise<ChatCompletion & { contextUsed: RetrievalResult[] }> {
    this.ensureKey();

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content:
          'You are the HiveMind orchestrator. Given user input and EMU context, craft a concise response that cites relevant EMU snippets.'
      },
      {
        role: 'user',
        content: `${message}\n\nContext:\n${context
          .map((hit, idx) => `${idx + 1}. [${hit.emuName}] ${hit.snippet}`)
          .join('\n')}`
      }
    ];

    const completion = await this.callEndpoint(messages, model, endpointOverride);
    return { ...completion, contextUsed: context };
  }

  async trainOnDocument(
    emuName: string,
    documentName: string,
    documentPreview: string,
    model?: string,
    endpointOverride?: string
  ): Promise<{ summary: string; model: string }> {
    this.ensureKey();
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content:
          'You are training an EMU block. Produce a structured summary (bullets) and recommended tags for retrieval.'
      },
      {
        role: 'user',
        content: `EMU: ${emuName}\nDocument: ${documentName}\nPreview:\n${documentPreview}`
      }
    ];

    const completion = await this.callEndpoint(messages, model, endpointOverride);
    return { summary: completion.reply, model: completion.model };
  }

  private async callEndpoint(messages: OpenRouterMessage[], model?: string, endpointOverride?: string): Promise<ChatCompletion> {
    this.ensureKey();
    const endpoint = endpointOverride || this.endpoint;
    const body = {
      model: model || this.defaultModel,
      messages,
      temperature: 0.2
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://hivemind.local',
        'X-Title': 'HiveMind Orchestrator'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      model: string;
      usage?: { total_tokens?: number };
    };

    return {
      reply: data.choices?.[0]?.message?.content || '',
      model: data.model,
      tokens: data.usage?.total_tokens
    };
  }
}
