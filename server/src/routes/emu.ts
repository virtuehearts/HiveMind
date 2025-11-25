import { Router } from 'express';
import { emuManager } from '../services/emuManager';

const router = Router();

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

export default router;

