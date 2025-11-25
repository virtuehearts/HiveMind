import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  routerModel: process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5:1.5b',
  allowOrigins:
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) || ['http://localhost:5173'],
  emuRoot: process.env.EMU_ROOT || path.join(process.cwd(), 'emus'),
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  openRouterEndpoint: process.env.OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
};
