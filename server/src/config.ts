import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  routerModel: process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5:1.5b',
  allowOrigins: process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) || ['http://localhost:5173']
};
