import { Router } from 'express';
import { config } from '../config';
import { OllamaClient } from '../services/ollamaClient';
import { RouterRequestBody } from '../types';
import { retrieve } from '../services/retriever';
import { OpenRouterClient } from '../services/openRouterClient';
import { emuManager } from '../services/emuManager';

const router = Router();
const ollama = new OllamaClient();
const openRouter = new OpenRouterClient();

router.get('/model', async (_req, res) => {
  const available = await ollama.checkModelAvailability(config.routerModel);
  res.json({ model: config.routerModel, available });
});

router.post('/route', async (req, res) => {
  const body = req.body as RouterRequestBody;
  if (!body?.message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const available = await ollama.checkModelAvailability(config.routerModel);
    if (!available) {
      return res.status(503).json({
        error: 'Router model not available',
        hint: `Pull it with: ollama pull ${config.routerModel}`
      });
    }
    const decision = await ollama.route(body.message);
    res.json(decision);
  } catch (error) {
    console.error('Router error', error);
    res.status(500).json({ error: 'Failed to route message' });
  }
});

router.post('/chat', async (req, res) => {
  const body = req.body as RouterRequestBody;
  if (!body?.message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const available = await ollama.checkModelAvailability(config.routerModel);
    if (!available) {
      return res.status(503).json({
        error: 'Router model not available',
        hint: `Pull it with: ollama pull ${config.routerModel}`
      });
    }
    await emuManager.ensureLoaded();
    const mounted = emuManager.listMounted();
    const context = mounted.length ? await retrieve(body.message, 4) : [];

    const completion = await ollama.chat(body.message, context);
    res.json(completion);
  } catch (error) {
    console.error('Chat error', error);
    res.status(500).json({ error: 'Failed to complete chat' });
  }
});

router.post('/chat/openrouter', async (req, res) => {
  const { message, model, endpoint } = req.body as { message?: string; model?: string; endpoint?: string };
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    await emuManager.ensureLoaded();
    const context = await retrieve(message, 6);
    const completion = await openRouter.chatWithContext(message, context, model, endpoint);
    res.json(completion);
  } catch (error) {
    console.error('OpenRouter error', error);
    res.status(500).json({ error: 'Failed to reach OpenRouter' });
  }
});

export default router;
