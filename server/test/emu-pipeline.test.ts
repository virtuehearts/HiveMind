import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import AdmZip from 'adm-zip';

const encoder = new TextEncoder();

function createMockFetch(html: string, ssePayload: string) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = typeof input === 'string' ? input : input.toString();

    if (!init || !init.method || init.method === 'GET') {
      return new Response(html, { status: 200 });
    }

    if (target.includes('openrouter.ai')) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(ssePayload));
          controller.close();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }

    return new Response('Unhandled request', { status: 404 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await delay(25);
  }
}

test('scrape → enrich → build pipeline yields loader-compatible EMU', async () => {
  const restoreCwd = process.cwd();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hivemind-pipeline-'));
  process.chdir(tempDir);

  process.env.EMU_BASE_PATH = path.join(tempDir, 'emus');
  process.env.EMU_MEMORY_STORE_PATH = path.join(tempDir, '.hivemind', 'emu-memory.json');
  process.env.EMU_BUILD_PATH = path.join(tempDir, '.hivemind', 'builds');
  process.env.GENERATED_PATH = path.join(tempDir, 'generated');

  const restoreFetch = createMockFetch(
    '<html><body><p>Example domain text for scraping.</p></body></html>',
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Summary: mock summary.' } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Q&A:\n- Q: What is this?\n  A: A test.' } }] })}\n`,
      'data: [DONE]\n'
    ].join('\n')
  );

  try {
    const { scrapeJobManager } = await import('../src/services/scrapeJob');
    const { openRouterJobManager } = await import('../src/services/openRouterJob');
    const { emuBuildJobManager } = await import('../src/services/emuBuildJob');
    const { EmuMemoryLayer } = await import('../src/services/emuMemoryLayer');

    (emuBuildJobManager as any).getEmbeddingPipeline = async () => async () => ({ data: [0.1, 0.2, 0.3] });
    (emuBuildJobManager as any).loadLance = async () => ({
      WriteMode: { Overwrite: 'overwrite' },
      connect: async (uri: string) => ({
        createTable: async (_name: string, rows: unknown[]) => {
          await fs.promises.mkdir(uri, { recursive: true });
          await fs.promises.writeFile(path.join(uri, 'chunks.json'), JSON.stringify(rows, null, 2), 'utf-8');
        }
      })
    });

    const scrapeJob = scrapeJobManager.createJob(['https://example.com/demo'], 'demo');
    await waitFor(() => scrapeJob.status === 'completed');
    assert.ok(scrapeJob.artifacts?.manifestPath);

    const generationJob = openRouterJobManager.createJob(['Generate retrieval pairs'], 'openai/mock', 'test-api-key');
    await waitFor(() => generationJob.status === 'completed');
    const generatedFile = path.join(process.cwd(), generationJob.items[0]?.filePath || '');
    assert.ok(fs.existsSync(generatedFile));

    const uploadManifest = {
      id: scrapeJob.id,
      filename: 'scraped-pages',
      mimeType: 'text/plain',
      createdAt: new Date().toISOString(),
      rawDir: scrapeJob.artifacts.rawDir,
      chunks: scrapeJob.artifacts.chunks
    } satisfies import('../src/types').UploadChunkArtifacts;

    const manifestPath = path.join(tempDir, 'upload-manifest.json');
    await fs.promises.writeFile(manifestPath, JSON.stringify(uploadManifest, null, 2), 'utf-8');

    const buildJob = await emuBuildJobManager.createJob({ manifestPath, name: 'scrape-demo' });
    await waitFor(() => buildJob.status === 'completed');

    const archivePath = emuBuildJobManager.getArchivePath(buildJob.id);
    assert.ok(archivePath && fs.existsSync(archivePath));
    const metadataPath = emuBuildJobManager.getMetadataPath(buildJob.id);
    assert.ok(metadataPath && fs.existsSync(metadataPath));

    const outputDir = path.join(tempDir, 'emu-output');
    new AdmZip(archivePath!).extractAllTo(outputDir, true);
    const emuDir = path.join(outputDir, `${buildJob.name}.emu`);
    const metadata = JSON.parse(await fs.promises.readFile(path.join(emuDir, 'metadata.json'), 'utf-8'));

    assert.strictEqual(metadata.notesPath, 'notes.md');
    assert.strictEqual(metadata.lanceDbPath, 'lancedb');
    assert.ok(fs.existsSync(path.join(emuDir, 'notes.md')));
    assert.ok(fs.existsSync(path.join(emuDir, 'config.yaml')));
    assert.ok(fs.existsSync(path.join(emuDir, 'lancedb', 'chunks.json')));

    const memoryLayer = new EmuMemoryLayer({
      emuBasePath: outputDir,
      storePath: path.join(tempDir, 'emu-memory.json')
    });
    assert.strictEqual(memoryLayer.listEmuMounts().length, 1);
    assert.ok(memoryLayer.listBlocks().length > 0);
  } finally {
    restoreFetch();
    process.chdir(restoreCwd);
  }
});
