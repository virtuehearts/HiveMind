import dotenv from 'dotenv';

dotenv.config();

// Centralized runtime configuration for the local-first router server.
export const config = {
  port: Number(process.env.PORT) || 4000,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  routerModel: process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5:1.5b-instruct',
  allowOrigins:
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) || ['http://localhost:5173'],
  // Approximate 64k token history window (assuming ~4 characters per token)
  maxContextCharacters: Number(process.env.MAX_CONTEXT_CHARACTERS) || 256000
};
