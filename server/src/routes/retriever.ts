import { Router } from 'express';
import { retrieve } from '../services/retriever';

const router = Router();

router.post('/retrieve', async (req, res) => {
  const { message, topK } = req.body as { message?: string; topK?: number };
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const results = await retrieve(message, topK || 5);
    res.json({ results });
  } catch (error) {
    console.error('Retrieve error', error);
    res.status(500).json({ error: 'Failed to retrieve context' });
  }
});

export default router;
