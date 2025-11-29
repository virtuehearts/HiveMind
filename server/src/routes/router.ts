import { Router } from 'express';
import multer from 'multer';
import { gzipSync } from 'zlib';
import { config } from '../config';
import { EmuMemoryLayer } from '../services/emuMemoryLayer';
import { OllamaClient } from '../services/ollamaClient';
import { MemoryBlockUpdatePayload, NewMemoryBlockPayload, RouterRequestBody } from '../types';
import pdfParse from 'pdf-parse';

const router = Router();
const ollama = new OllamaClient();
const memoryLayer = new EmuMemoryLayer({
  storePath: config.memoryStorePath,
  emuBasePath: config.emuBasePath
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/model', async (_req, res) => {
  const available = await ollama.checkModelAvailability(config.routerModel);
  res.json({ model: config.routerModel, available });
});

router.get('/memory/status', (_req, res) => {
  res.json(memoryLayer.getStatus());
});

router.get('/memory/blocks', (_req, res) => {
  res.json(memoryLayer.listBlocks());
});

router.get('/memory/blocks/:id', (req, res) => {
  const block = memoryLayer.getBlock(req.params.id);
  if (!block) {
    return res.status(404).json({ error: 'Memory block not found' });
  }

  res.json(block);
});

router.post('/memory/blocks', (req, res) => {
  const payload = req.body as NewMemoryBlockPayload;
  if (!payload?.content) {
    return res.status(400).json({ error: 'Memory content is required' });
  }

  try {
    const stored = memoryLayer.addBlock(payload);
    res.json(stored);
  } catch (error) {
    console.error('Unable to store memory block', error);
    res.status(500).json({ error: 'Failed to store memory block' });
  }
});

router.patch('/memory/blocks/:id', (req, res) => {
  const updates = req.body as MemoryBlockUpdatePayload;
  try {
    const block = memoryLayer.updateBlock(req.params.id, updates);
    res.json(block);
  } catch (error) {
    console.error('Unable to update memory block', error);
    res.status(404).json({ error: 'Memory block not found' });
  }
});

router.delete('/memory/blocks/:id', (req, res) => {
  const removed = memoryLayer.deleteBlock(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Memory block not found' });
  }

  res.json({ ok: true });
});

router.get('/memory/blocks/:id/export', (req, res) => {
  const block = memoryLayer.getBlock(req.params.id);
  if (!block) {
    return res.status(404).json({ error: 'Memory block not found' });
  }

  const payload = JSON.stringify(block, null, 2);
  const archive = gzipSync(payload);
  const safeName = `${block.title || block.id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64);

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName || block.id}.json.gz"`);
  res.send(archive);
});

router.post('/memory/import', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const title = req.body.title?.trim();
  const tags = req.body.tags?.trim();

  try {
    let content = '';

    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(file.buffer);
      content = parsed.text;
    } else {
      content = file.buffer.toString('utf-8');
    }

    if (!content.trim()) {
      return res.status(400).json({ error: 'File did not contain readable text' });
    }

    const block = memoryLayer.addBlock({
      title: title || file.originalname,
      content,
      source: `upload:${file.originalname}`,
      tags: tags ? tags.split(',').map((tag: string) => tag.trim()).filter(Boolean) : undefined
    });

    res.json(block);
  } catch (error) {
    console.error('Failed to import memory file', error);
    res.status(500).json({ error: 'Unable to import document into EMU memory' });
  }
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

    const searchQuery = body.transformedQuery || body.message;
    const relevantBlocks = memoryLayer.findRelevantBlocks(searchQuery, {
      intents: body.intent ? [body.intent] : undefined,
      tags: body.tags
    });

    const memoryContext = relevantBlocks
      .map((block) => {
        const tags = block.tags.slice(0, 4).join(', ');
        return `- (${block.intent}) [${tags}] ${block.title}: ${block.summary}`;
      })
      .join('\n');

    const completion = await ollama.chat(
      body.message,
      sessionId,
      body.transformedQuery,
      memoryContext,
      relevantBlocks
    );
    res.json(completion);
  } catch (error) {
    console.error('Chat error', error);
    res.status(500).json({ error: 'Failed to complete chat' });
  }
});

export default router;
