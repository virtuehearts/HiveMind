import dotenv from 'dotenv';

dotenv.config();

const defaultAllowOrigins: (string | RegExp)[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  // GitHub Codespaces style forwarded ports, e.g. https://4000-abc123.app.github.dev
  /^https?:\/\/(\d+)-[\w.-]+\.app\.github\.dev$/
];

const envAllowOrigins =
  process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

// Centralized runtime configuration for the local-first router server.
export const config = {
  port: Number(process.env.PORT) || 4000,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  routerModel: process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5:1.5b-instruct',
  allowOrigins: [...defaultAllowOrigins, ...envAllowOrigins],
  // Approximate 64k token history window (assuming ~4 characters per token)
  maxContextCharacters: Number(process.env.MAX_CONTEXT_CHARACTERS) || 256000
};
