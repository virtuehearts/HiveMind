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
    const available = await ollama.checkModelAvailability(config.routerModel);
    if (!available) {
      return res.status(503).json({
        error: 'Router model not available',
        hint: `Pull it with: ollama pull ${config.routerModel}`
      });
    }
    const history = ollama.getHistory(body.sessionId || 'default');
    const decision = await ollama.route(body.message, history);
    res.json(decision);
  } catch (error) {
    console.error('Router error', error);
    res.status(500).json({ error: 'Failed to route message' });
  }
});

router.post('/chat', async (req, res) => {
  const body = req.body as RouterRequestBody & { transformedQuery?: string };
  if (!body?.message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const sessionId = body.sessionId || 'default';

  try {
    const available = await ollama.checkModelAvailability(config.routerModel);
    if (!available) {
      return res.status(503).json({
        error: 'Router model not available',
        hint: `Pull it with: ollama pull ${config.routerModel}`
      });
    }

    const completion = await ollama.chat(body.message, sessionId, body.transformedQuery);
    res.json(completion);
  } catch (error) {
    console.error('Chat error', error);
    res.status(500).json({ error: 'Failed to complete chat' });
  }
});

export default router;
