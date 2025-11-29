import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import { EmuBuildJob, EmuBuildLog, EmuBuildMetadata, UploadChunkArtifacts } from '../types';
import { TOKEN_CHAR_RATIO } from './textChunker';

const execFileAsync = promisify(execFile);

interface BuildRequest {
  manifestPath: string;
  name?: string;
  trainedBy?: string;
  queryPrompts?: string[];
  signArtifacts?: boolean;
}

interface LanceDBModule {
  connect: (uri: string) => Promise<any>;
  WriteMode?: { Overwrite: unknown };
}

export class EmuBuildJobManager {
  private jobs = new Map<string, EmuBuildJob>();
  private embeddingPipeline: Promise<any> | null = null;

  listJobs(): EmuBuildJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): EmuBuildJob | undefined {
    return this.jobs.get(id);
  }

  async createJob(request: BuildRequest): Promise<EmuBuildJob> {
    const manifestPath = path.resolve(process.cwd(), request.manifestPath);
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest file not found; run ingest before building');
    }

    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as UploadChunkArtifacts;
    if (!manifest?.chunks?.length) {
      throw new Error('Manifest did not contain any chunk records');
    }

    const name = this.sanitizeName(request.name || manifest.filename || 'dataset');
    const job: EmuBuildJob = {
      id: `build-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
      name,
      manifestPath: path.relative(process.cwd(), manifestPath),
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: []
    };

    this.jobs.set(job.id, job);
    void this.processJob(job, manifest, request);
    return job;
  }

  getArchivePath(id: string): string | null {
    const job = this.jobs.get(id);
    if (!job?.archivePath) return null;
    const absPath = path.resolve(process.cwd(), job.archivePath);
    return fs.existsSync(absPath) ? absPath : null;
  }

  getMetadataPath(id: string): string | null {
    const job = this.jobs.get(id);
    if (!job?.metadataPath) return null;
    const absPath = path.resolve(process.cwd(), job.metadataPath);
    return fs.existsSync(absPath) ? absPath : null;
  }

  private async processJob(job: EmuBuildJob, manifest: UploadChunkArtifacts, request: BuildRequest) {
    try {
      job.status = 'running';
      this.touch(job, { step: 'init', message: 'Preparing build workspace' });

      const buildRoot = path.join(config.buildOutputPath, job.id);
      const emuFolderName = `${job.name}.emu`;
      const emuFolder = path.join(buildRoot, emuFolderName);
      const lancePath = path.join(emuFolder, 'lancedb');
      await fs.promises.rm(buildRoot, { recursive: true, force: true });
      await fs.promises.mkdir(emuFolder, { recursive: true });

      const { rows, totalTokens, totalBytes, sourceUrls, noteSections } = await this.embedChunks(
        manifest,
        emuFolder
      );

      this.touch(job, { step: 'embedding', message: `Embedded ${rows.length} chunks into LanceDB` });

      const metadata = await this.writeOutputs({
        emuFolder,
        emuFolderName,
        lancePath,
        rows,
        totalTokens,
        totalBytes,
        manifest,
        sourceUrls,
        request,
        noteSections
      });

      job.metadata = metadata;
      job.metadataPath = path.relative(process.cwd(), path.join(emuFolder, 'metadata.json'));
      job.outputDir = path.relative(process.cwd(), emuFolder);

      const archivePath = await this.packageArchive(emuFolder, emuFolderName, request.signArtifacts);
      job.archivePath = path.relative(process.cwd(), archivePath);

      job.status = 'completed';
      this.touch(job, { step: 'complete', message: `EMU packaged at ${archivePath}` });
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown build error';
      this.touch(job, { step: 'error', message: job.error });
    }
  }

  private async embedChunks(manifest: UploadChunkArtifacts, emuFolder: string) {
    const rows: Array<{ id: string; text: string; source: string; approxTokens: number; embedding: number[] }> = [];
    const noteSections: string[] = [];
    const sourceUrls = new Set<string>();
    let totalTokens = 0;
    let totalBytes = 0;

    const buildDir = path.dirname(path.resolve(process.cwd(), manifest.rawDir));
    const embeddingModel = await this.getEmbeddingPipeline();

    for (const [index, chunk] of manifest.chunks.entries()) {
      const chunkPath = path.resolve(buildDir, chunk.file);
      const text = await fs.promises.readFile(chunkPath, 'utf-8');
      const approxTokens = chunk.approxTokens || Math.round(text.length / TOKEN_CHAR_RATIO);
      const embedding = await embeddingModel(text, { pooling: 'mean', normalize: true });
      const rawEmbedding = (embedding as { data?: Iterable<number> }).data || (embedding as Iterable<number>);
      const vector: number[] = Array.from(rawEmbedding as Iterable<number>).map((value) => Number(value));

      rows.push({
        id: `${manifest.id || 'chunk'}-${index + 1}`,
        text,
        source: chunk.url,
        approxTokens,
        embedding: vector
      });

      totalTokens += approxTokens;
      totalBytes += Buffer.byteLength(text, 'utf-8');
      if (chunk.url) sourceUrls.add(chunk.url);
      noteSections.push(`## ${chunk.url || `Chunk ${index + 1}`}\n\n${text.trim()}`);
    }

    const lanceModule = await this.loadLance();
    const lancePath = path.join(emuFolder, 'lancedb');
    await fs.promises.mkdir(lancePath, { recursive: true });
    const db = await lanceModule.connect(lancePath);
    const writeMode = (lanceModule.WriteMode as any)?.Overwrite;
    await db.createTable('chunks', rows, writeMode ? { writeMode } : undefined);

    return { rows, totalTokens, totalBytes, sourceUrls, noteSections };
  }

  private async writeOutputs(params: {
    emuFolder: string;
    emuFolderName: string;
    lancePath: string;
    rows: Array<{ id: string; text: string; source: string; approxTokens: number; embedding: number[] }>;
    totalTokens: number;
    totalBytes: number;
    manifest: UploadChunkArtifacts;
    sourceUrls: Set<string>;
    request: BuildRequest;
    noteSections: string[];
  }): Promise<EmuBuildMetadata> {
    const { emuFolder, lancePath, rows, totalTokens, totalBytes, manifest, sourceUrls, request, noteSections } = params;

    const metadata: EmuBuildMetadata = {
      id: manifest.id || params.emuFolderName.replace(/\.emu$/, ''),
      name: request.name || manifest.filename || params.emuFolderName.replace(/\.emu$/, ''),
      trained_by: request.trainedBy || config.trainedBy,
      trained_at: new Date().toISOString(),
      approx_tokens: totalTokens,
      source_urls: Array.from(sourceUrls),
      query_prompts: (request.queryPrompts || []).filter(Boolean),
      embedding_model: 'Xenova/all-MiniLM-L6-v2',
      chunk_count: rows.length,
      dataset_size_bytes: totalBytes,
      notesPath: 'notes.md',
      lanceDbPath: path.relative(process.cwd(), lancePath)
    };

    const notesBody = ['# EMU training notes', '', ...noteSections].join('\n\n');
    await fs.promises.writeFile(path.join(emuFolder, 'notes.md'), notesBody, 'utf-8');

    const configYaml = `embeddingModel: ${metadata.embedding_model}\nretriever:\n  topK: 4\n  keywordWeight: 0.25\nchunking:\n  size: 512\n  overlap: 64\n`;
    await fs.promises.writeFile(path.join(emuFolder, 'config.yaml'), configYaml, 'utf-8');
    await fs.promises.writeFile(path.join(emuFolder, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    return metadata;
  }

  private async packageArchive(emuFolder: string, emuFolderName: string, signArtifacts?: boolean): Promise<string> {
    const zip = new AdmZip();
    zip.addLocalFolder(emuFolder, emuFolderName);

    await fs.promises.mkdir(config.buildOutputPath, { recursive: true });
    const archivePath = path.join(config.buildOutputPath, `${emuFolderName}.zip`);
    zip.writeZip(archivePath);

    if (signArtifacts && config.pgpSignCommand) {
      try {
        await execFileAsync(config.pgpSignCommand, [archivePath]);
      } catch (error) {
        console.warn('PGP signing hook failed', error);
      }
    }

    return archivePath;
  }

  private sanitizeName(value: string): string {
    const cleaned = value
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80);

    return cleaned || 'dataset';
  }

  private touch(job: EmuBuildJob, log?: Omit<EmuBuildLog, 'timestamp'>) {
    job.updatedAt = new Date().toISOString();
    if (log) {
      job.logs = [...job.logs, { ...log, timestamp: new Date().toISOString() }];
    }
    this.jobs.set(job.id, { ...job });
  }

  private async getEmbeddingPipeline() {
    if (!this.embeddingPipeline) {
      this.embeddingPipeline = import('@xenova/transformers').then(({ pipeline }) =>
        pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      );
    }

    return this.embeddingPipeline;
  }

  private async loadLance(): Promise<LanceDBModule> {
    const lanceModule = await import('@lancedb/lancedb');
    return lanceModule as LanceDBModule;
  }
}

export const emuBuildJobManager = new EmuBuildJobManager();
