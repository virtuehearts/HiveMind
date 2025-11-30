import { config } from '../config';
import { ConversationTurn } from '../types';

const decoder = new TextDecoder();

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamResult {
  reply: string;
  model: string;
  latencyMs: number;
}

export interface OpenRouterStatus {
  ok: boolean;
  status: number;
  message: string;
  model: string;
}

export async function streamOpenRouterChat(
  messages: OpenRouterMessage[],
  onToken: (token: string) => void,
  options?: { model?: string; apiKey?: string }
): Promise<StreamResult> {
  const apiKey = options?.apiKey?.trim() || config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OpenRouter API key is required');
  }

  const model = options?.model || config.openRouterModel;
  const started = Date.now();

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter error ${response.status}: ${text || 'No response body'}`);
  }

  const reader = response.body.getReader();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const delta: string =
          parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || '';

        if (delta) {
          content += delta;
          onToken(delta);
        }
      } catch (error) {
        continue;
      }
    }
  }

  return { reply: content.trim(), model, latencyMs: Date.now() - started };
}

export function toOpenRouterMessages(
  systemPrompt: string,
  history: ConversationTurn[],
  userContent: string
): OpenRouterMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: userContent }
  ];
}

export async function checkOpenRouterConnection(options?: { model?: string; apiKey?: string }): Promise<OpenRouterStatus> {
  const apiKey = options?.apiKey?.trim() || config.openRouterApiKey;
  const model = options?.model || config.openRouterModel;

  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      message: 'OpenRouter API key is missing',
      model
    };
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'Connection check' },
          { role: 'user', content: 'Confirm connectivity only. Do not generate.' }
        ],
        max_tokens: 1
      })
    });

    const text = await response.text().catch(() => '');

    return {
      ok: response.ok,
      status: response.status,
      message: text || (response.ok ? 'OpenRouter reachable' : 'Received empty response'),
      model
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network failure';
    return {
      ok: false,
      status: 0,
      message: `Network error: ${message}`,
      model
    };
  }
}
