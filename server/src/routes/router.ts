import { Router } from 'express';
import { config } from '../config';
import { OllamaClient } from '../services/ollamaClient';
import { RouterRequestBody } from '../types';

const router = Router();
const ollama = new OllamaClient();

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
    const completion = await ollama.chat(body.message);
    res.json(completion);
  } catch (error) {
    console.error('Chat error', error);
    res.status(500).json({ error: 'Failed to complete chat' });
  }
});

export default router;
