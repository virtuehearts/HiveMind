import { Router } from 'express';
import multer from 'multer';
import { emuManager } from '../services/emuManager';
import { OpenRouterClient } from '../services/openRouterClient';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const openRouter = new OpenRouterClient();

router.get('/emus', async (_req, res) => {
  await emuManager.refreshAvailable();
  res.json({ emus: emuManager.listAvailable(), mounted: emuManager.listMounted() });
});

router.post('/emus/mount', async (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id) return res.status(400).json({ error: 'EMU id is required' });

  try {
    await emuManager.refreshAvailable();
    const mounted = await emuManager.mount(id);
    res.json({ mounted: emuManager.listMounted(), active: mounted });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

router.post('/emus/unmount', async (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id) return res.status(400).json({ error: 'EMU id is required' });

  await emuManager.ensureLoaded();
  emuManager.unmount(id);
  res.json({ mounted: emuManager.listMounted() });
});

router.post('/emus/upload', upload.single('file'), async (req, res) => {
  const { id, name, description, tags, notesPath } = req.body as {
    id?: string;
    name?: string;
    description?: string;
    tags?: string;
    notesPath?: string;
  };

  if (!req.file) {
    return res.status(400).json({ error: 'File is required' });
  }

  const resolvedId = id || req.file.originalname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const parsedTags = tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined;

  try {
    const emu = await emuManager.ingestDocument({
      id: resolvedId,
      name,
      description,
      tags: parsedTags,
      notesPath,
      fileName: req.file.originalname,
      buffer: req.file.buffer
    });
    res.status(201).json({ emu });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/emus/:id/download', async (req, res) => {
  const { id } = req.params;
  try {
    const payload = await emuManager.download(id);
    res.json(payload);
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

router.post('/emus/:id/train', async (req, res) => {
  const { id } = req.params;
  const { model, endpoint } = req.body as { model?: string; endpoint?: string };

  try {
    const payload = await emuManager.download(id);
    const preview = payload.notes?.slice(0, 800) || 'No notes found';
    const latestBlock = payload.emu.blockVersions?.[payload.emu.blockVersions.length - 1];
    const documentName = latestBlock?.file || 'notes.md';

    const result = await openRouter.trainOnDocument(payload.emu.name, documentName, preview, model, endpoint);

    if (latestBlock) {
      latestBlock.summary = result.summary.slice(0, 400);
    }

    res.json({ summary: result.summary, model: result.model, document: documentName });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;

