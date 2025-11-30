import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { gzipSync } from 'zlib';
import { config } from '../config';
import { EmuMemoryLayer } from '../services/emuMemoryLayer';
import { TOKEN_CHAR_RATIO, chunkText } from '../services/textChunker';
import { OllamaClient } from '../services/ollamaClient';
import { openRouterJobManager } from '../services/openRouterJob';
import {
  checkOpenRouterConnection,
  streamOpenRouterChat,
  toOpenRouterMessages
} from '../services/openRouterClient';
import { scrapeJobManager } from '../services/scrapeJob';
import { emuBuildJobManager } from '../services/emuBuildJob';
import {
  MemoryBlockUpdatePayload,
  NewMemoryBlockPayload,
  RouterRequestBody,
  ScrapeJob,
  QueryGenerationJob,
  UploadChunkArtifacts,
  EmuBuildJob
} from '../types';
import pdfParse from 'pdf-parse';
import { chatSystemPrompt } from '../services/prompts';

const router = Router();
const ollama = new OllamaClient();
const memoryLayer = new EmuMemoryLayer({
  storePath: config.memoryStorePath,
  emuBasePath: config.emuBasePath
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const emuUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const uploadBuildRoot = path.resolve(process.cwd(), '.hivemind', 'uploads');

const formatScrapeJob = (job: ScrapeJob) => ({
  id: job.id,
  name: job.name,
  status: job.status,
  urls: job.urls,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  warnings: job.warnings,
  error: job.error,
  artifacts: job.artifacts && {
    buildDir: job.artifacts.buildDir,
    rawDir: job.artifacts.rawDir,
    manifestPath: job.artifacts.manifestPath,
    chunks: job.artifacts.chunks
  }
});

const formatGenerationJob = (job: QueryGenerationJob) => ({
  id: job.id,
  model: job.model,
  prompt: job.prompt,
  status: job.status,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  total: job.total,
  completed: job.completed,
  failed: job.failed,
  generatedDir: job.generatedDir,
  items: job.items
});

const formatBuildJob = (job: EmuBuildJob) => ({
  id: job.id,
  name: job.name,
  status: job.status,
  manifestPath: job.inputs.manifestPath,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  outputDir: job.artifacts.outputDir,
  archivePath: job.artifacts.archivePath,
  metadataPath: job.artifacts.metadataPath,
  signaturePath: job.artifacts.signaturePath,
  metadata: job.metadata,
  logs: job.logs,
  steps: job.steps,
  artifacts: job.artifacts,
  inputs: job.inputs,
  error: job.error
});

const parseQueries = (body: any, file?: Express.Multer.File): string[] => {
  const lines: string[] = [];

  if (Array.isArray(body?.queries)) {
    lines.push(...body.queries.map((entry: any) => (typeof entry === 'string' ? entry : '')).filter(Boolean));
  } else if (typeof body?.queries === 'string') {
    try {
      const parsed = JSON.parse(body.queries);
      if (Array.isArray(parsed)) {
        lines.push(...parsed.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean));
      }
    } catch (error) {
      lines.push(...body.queries.split(/\r?\n/));
    }
  }

  if (typeof body?.queriesText === 'string') {
    lines.push(...body.queriesText.split(/\r?\n/));
  }

  if (file) {
    const text = file.buffer.toString('utf-8');
    lines.push(...text.split(/\r?\n/));
  }

  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((value, index, self) => self.indexOf(value) === index);
};

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

router.get('/emus', (_req, res) => {
  res.json(memoryLayer.listEmuMounts());
});

router.post('/scrape', (req, res) => {
  const body = req.body as { urls?: unknown; name?: unknown };
  const urls = Array.isArray(body.urls)
    ? body.urls
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter((url) => /^https?:\/\//.test(url))
    : [];

  if (!urls.length) {
    return res.status(400).json({ error: 'At least one valid URL is required' });
  }

  const job = scrapeJobManager.createJob(urls, typeof body.name === 'string' ? body.name : undefined);
  res.json(formatScrapeJob(job));
});

router.get('/scrape/:jobId', (req, res) => {
  const job = scrapeJobManager.getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Scrape job not found' });
  }

  res.json(formatScrapeJob(job));
});

router.post('/openrouter/jobs', upload.single('queriesFile'), (req, res) => {
  const apiKey = (req.body?.apiKey as string | undefined)?.trim() || config.openRouterApiKey;
  if (!apiKey) {
    return res.status(400).json({ error: 'OpenRouter API key is required' });
  }

  const queries = parseQueries(req.body, req.file);
  if (!queries.length) {
    return res.status(400).json({ error: 'At least one query is required' });
  }

  const model = (req.body?.model as string | undefined)?.trim() || config.openRouterModel;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : undefined;

  try {
    const job = openRouterJobManager.createJob(queries, model, apiKey, prompt);
    res.json(formatGenerationJob(job));
  } catch (error) {
    console.error('Failed to start OpenRouter job', error);
    res.status(500).json({ error: 'Unable to start OpenRouter generation' });
  }
});

router.get('/openrouter/jobs', (_req, res) => {
  const jobs = openRouterJobManager.listJobs().map(formatGenerationJob);
  res.json(jobs);
});

router.get('/openrouter/jobs/:id', (req, res) => {
  const job = openRouterJobManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(formatGenerationJob(job));
});

router.post('/openrouter/status', async (req, res) => {
  const apiKey = (req.body?.apiKey as string | undefined)?.trim() || config.openRouterApiKey;
  const model = (req.body?.model as string | undefined)?.trim() || config.openRouterModel;

  try {
    const status = await checkOpenRouterConnection({ apiKey, model });
    res.json(status);
  } catch (error) {
    console.error('Failed to check OpenRouter connectivity', error);
    res.status(500).json({
      ok: false,
      status: 500,
      message: 'Unable to check OpenRouter connectivity',
      model
    });
  }
});

router.post('/emu/build', async (req, res) => {
  const body = req.body as {
    manifestPath?: string;
    name?: string;
    trainedBy?: string;
    queryPrompts?: string[];
    signArtifacts?: boolean;
  };

  if (!body?.manifestPath) {
    return res.status(400).json({ error: 'manifestPath is required to build an EMU' });
  }

  try {
    const job = await emuBuildJobManager.createJob({
      manifestPath: body.manifestPath,
      name: typeof body.name === 'string' ? body.name : undefined,
      trainedBy: typeof body.trainedBy === 'string' ? body.trainedBy : undefined,
      queryPrompts: Array.isArray(body.queryPrompts)
        ? body.queryPrompts.map((entry) => (typeof entry === 'string' ? entry : '')).filter(Boolean)
        : undefined,
      signArtifacts: Boolean(body.signArtifacts)
    });
    res.json(formatBuildJob(job));
  } catch (error) {
    console.error('Failed to start EMU build', error);
    const message = error instanceof Error ? error.message : 'Unable to start EMU build';
    res.status(500).json({ error: message });
  }
});

router.get('/emu/build', (_req, res) => {
  res.json(emuBuildJobManager.listJobs().map(formatBuildJob));
});

router.get('/emu/build/:id', (req, res) => {
  const job = emuBuildJobManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'EMU build job not found' });
  }

  res.json(formatBuildJob(job));
});

router.get('/emu/build/:id/stream', (req, res) => {
  const job = emuBuildJobManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'EMU build job not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendUpdate = (next: EmuBuildJob) => {
    if (next.id !== job.id) return;
    const payload = `data: ${JSON.stringify(formatBuildJob(next))}\n\n`;
    res.write(payload);
  };

  const unsubscribe = emuBuildJobManager.subscribe(sendUpdate);
  sendUpdate(job);

  const interval = setInterval(() => res.write(': keep-alive\n\n'), 20000);

  req.on('close', () => {
    clearInterval(interval);
    unsubscribe();
  });
});

router.get('/emu/build/:id/download', (req, res) => {
  const archivePath = emuBuildJobManager.getArchivePath(req.params.id);
  if (!archivePath) {
    return res.status(404).json({ error: 'Archive not available yet' });
  }

  res.sendFile(archivePath, { headers: { 'Content-Type': 'application/zip' } });
});

router.get('/emu/build/:id/metadata', (req, res) => {
  const metadataPath = emuBuildJobManager.getMetadataPath(req.params.id);
  if (!metadataPath) {
    return res.status(404).json({ error: 'Metadata not available yet' });
  }

  res.sendFile(metadataPath, { headers: { 'Content-Type': 'application/json' } });
});

router.post('/ingest/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  const isText = /^text\//.test(file.mimetype) || /\.(txt|md|markdown)$/i.test(file.originalname);

  if (!isPdf && !isText) {
    return res.status(415).json({ error: 'Only PDF or text uploads are supported' });
  }

  try {
    let rawText = '';

    if (isPdf) {
      const parsed = await pdfParse(file.buffer);
      rawText = parsed.text;
    } else {
      rawText = file.buffer.toString('utf-8');
    }

    const cleaned = rawText.trim();
    if (!cleaned) {
      return res.status(400).json({ error: 'Uploaded file did not contain readable text' });
    }

    const chunks = chunkText(cleaned);
    if (!chunks.length) {
      return res.status(400).json({ error: 'No chunks were generated from the upload' });
    }

    const id = crypto.randomUUID();
    const buildDir = path.join(uploadBuildRoot, id);
    const rawDir = path.join(buildDir, 'raw');
    await fs.promises.mkdir(rawDir, { recursive: true });

    const chunkRecords: UploadChunkArtifacts['chunks'] = [];
    let chunkIndex = 1;
    const mimeType = file.mimetype || 'application/octet-stream';

    for (const chunk of chunks) {
      const filename = `chunk-${String(chunkIndex).padStart(4, '0')}.txt`;
      const filePath = path.join(rawDir, filename);
      const content = `Source: ${file.originalname}\nMIME: ${mimeType}\n\n${chunk.trim()}\n`;
      await fs.promises.writeFile(filePath, content, 'utf8');
      const stats = await fs.promises.stat(filePath);

      chunkRecords.push({
        url: file.originalname,
        file: path.relative(buildDir, filePath),
        bytes: stats.size,
        characters: content.length,
        approxTokens: Math.round(content.length / TOKEN_CHAR_RATIO)
      });

      chunkIndex += 1;
    }

    const manifest: UploadChunkArtifacts = {
      id,
      filename: file.originalname,
      mimeType,
      createdAt: new Date().toISOString(),
      rawDir: path.relative(process.cwd(), rawDir),
      chunks: chunkRecords
    };

    const manifestPath = path.join(buildDir, 'manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    res.json({
      ...manifest,
      buildDir: path.relative(process.cwd(), buildDir),
      manifestPath: path.relative(process.cwd(), manifestPath)
    });
  } catch (error) {
    console.error('Failed to chunk upload', error);
    res.status(500).json({ error: 'Failed to process upload' });
  }
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

router.get('/emus/:id/download', (req, res) => {
  try {
    const archive = memoryLayer.exportEmuArchive(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
    res.send(archive.buffer);
  } catch (error) {
    console.error('Unable to export EMU archive', error);
    res.status(404).json({ error: 'EMU not found or could not be packaged' });
  }
});

router.post('/emus/upload', emuUpload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No EMU archive uploaded' });
  }

  try {
    const mount = memoryLayer.importEmuArchive(file.buffer, file.originalname);
    res.json(mount);
  } catch (error) {
    console.error('Failed to ingest EMU archive', error);
    res.status(400).json({ error: 'Unable to import EMU archive' });
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

router.post('/chat/remote', async (req, res) => {
  const body = req.body as RouterRequestBody & {
    transformedQuery?: string;
    apiKey?: string;
    model?: string;
  };

  if (!body?.message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const sessionId = body.sessionId || 'default';

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

  const systemPrompt =
    memoryContext.length > 0
      ? `${chatSystemPrompt}\n\nLocal EMU memory blocks:\n${memoryContext}\nUse them when relevant.`
      : chatSystemPrompt;

  const history = ollama.getHistory(sessionId);
  const messages = toOpenRouterMessages(systemPrompt, history, searchQuery);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    let accumulated = '';
    await streamOpenRouterChat(messages, (token) => {
      accumulated += token;
      res.write(token);
    },
    { model: body.model, apiKey: body.apiKey });

    ollama.appendToHistory(sessionId, [
      { role: 'user', content: searchQuery },
      { role: 'assistant', content: accumulated }
    ]);

    res.end();
  } catch (error) {
    console.error('OpenRouter streaming error', error);
    res.write(`\n[error] ${error instanceof Error ? error.message : 'Unknown error'}`);
    res.end();
  }
});

export default router;
