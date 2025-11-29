import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import {
  EmuBuildArtifacts,
  EmuBuildInputs,
  EmuBuildJob,
  EmuBuildLog,
  EmuBuildMetadata,
  EmuBuildStepKey,
  EmuBuildStepStatus,
  UploadChunkArtifacts
} from '../types';
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
  private subscribers = new Set<(job: EmuBuildJob) => void>();

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
    const jobIdFragment = `build-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const buildDir = path.join(config.buildOutputPath, jobIdFragment);
    const inputs: EmuBuildInputs = {
      manifestPath: path.relative(process.cwd(), manifestPath),
      name,
      trainedBy: request.trainedBy,
      queryPrompts: request.queryPrompts,
      signArtifacts: request.signArtifacts
    };

    const artifacts: EmuBuildArtifacts = {
      buildDir: path.relative(process.cwd(), buildDir),
      manifestPath: path.relative(process.cwd(), manifestPath)
    };
    const job: EmuBuildJob = {
      id: jobIdFragment,
      name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputs,
      artifacts,
      steps: this.initializeSteps(),
      logs: []
    };

    this.jobs.set(job.id, job);
    void this.processJob(job, manifest, request);
    return job;
  }

  getArchivePath(id: string): string | null {
    const job = this.jobs.get(id);
    const archivePath = job?.artifacts.archivePath;
    if (!archivePath) return null;
    const absPath = path.resolve(process.cwd(), archivePath);
    return fs.existsSync(absPath) ? absPath : null;
  }

  getMetadataPath(id: string): string | null {
    const job = this.jobs.get(id);
    const metadataPath = job?.artifacts.metadataPath;
    if (!metadataPath) return null;
    const absPath = path.resolve(process.cwd(), metadataPath);
    return fs.existsSync(absPath) ? absPath : null;
  }

  private async processJob(job: EmuBuildJob, manifest: UploadChunkArtifacts, request: BuildRequest) {
    const buildRoot = path.join(config.buildOutputPath, job.id);
    const emuFolderName = `${job.name}.emu`;
    const emuFolder = path.join(buildRoot, emuFolderName);
    const lancePath = path.join(emuFolder, 'lancedb');

    try {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      this.startStep(job, 'init', 'Preparing build workspace');

      await fs.promises.rm(buildRoot, { recursive: true, force: true });
      await fs.promises.mkdir(emuFolder, { recursive: true });
      this.finishStep(job, 'init', 'Build workspace ready');

      this.startStep(job, 'embed', 'Embedding chunks into LanceDB');
      const { rows, totalTokens, totalBytes, sourceUrls, noteSections } = await this.embedChunks(
        manifest,
        emuFolder
      );
      this.finishStep(job, 'embed', `Embedded ${rows.length} chunks into LanceDB`);

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
      job.artifacts.outputDir = path.relative(process.cwd(), emuFolder);

      this.startStep(job, 'package', 'Packaging EMU artifacts');
      const archivePath = await this.packageArchive(buildRoot, emuFolder, emuFolderName, request.signArtifacts);
      job.artifacts.archivePath = path.relative(process.cwd(), archivePath);

      const exposedMetadataPath = path.join(config.buildOutputPath, `${job.id}-metadata.json`);
      await fs.promises.cp(path.join(emuFolder, 'metadata.json'), exposedMetadataPath, { force: true });
      job.artifacts.metadataPath = path.relative(process.cwd(), exposedMetadataPath);

      job.status = 'completed';
      job.finishedAt = new Date().toISOString();
      this.finishStep(job, 'package', `EMU packaged at ${archivePath}`);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown build error';
      this.failStep(job, 'package', job.error);
    } finally {
      await this.cleanupWorkspace(buildRoot, job.status === 'completed');
      this.finishStep(job, 'cleanup', 'Workspace cleaned up');
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
      lanceDbPath: 'lancedb'
    };

    const notesBody = ['# EMU training notes', '', ...noteSections].join('\n\n');
    await fs.promises.writeFile(path.join(emuFolder, 'notes.md'), notesBody, 'utf-8');

    const configYaml = `embeddingModel: ${metadata.embedding_model}\nretriever:\n  topK: 4\n  keywordWeight: 0.25\nchunking:\n  size: 512\n  overlap: 64\n`;
    await fs.promises.writeFile(path.join(emuFolder, 'config.yaml'), configYaml, 'utf-8');
    await fs.promises.writeFile(path.join(emuFolder, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

    return metadata;
  }

  private async packageArchive(
    buildRoot: string,
    emuFolder: string,
    emuFolderName: string,
    signArtifacts?: boolean
  ): Promise<string> {
    const zip = new AdmZip();
    zip.addLocalFolder(emuFolder, emuFolderName);

    await fs.promises.mkdir(config.buildOutputPath, { recursive: true });
    const archivePath = path.join(config.buildOutputPath, `${path.basename(buildRoot)}-${emuFolderName}.zip`);
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
    const snapshot = { ...job };
    this.jobs.set(job.id, snapshot);
    this.notify(snapshot);
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

  subscribe(listener: (job: EmuBuildJob) => void) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private notify(job: EmuBuildJob) {
    for (const listener of this.subscribers) {
      listener(job);
    }
  }

  private initializeSteps(): EmuBuildJob['steps'] {
    const now = new Date().toISOString();
    return [
      { key: 'init', status: 'pending', startedAt: now },
      { key: 'embed', status: 'pending' },
      { key: 'package', status: 'pending' },
      { key: 'cleanup', status: 'pending' }
    ];
  }

  private updateStep(job: EmuBuildJob, key: EmuBuildStepKey, status: EmuBuildStepStatus, message?: string) {
    const step = job.steps.find((entry) => entry.key === key);
    if (!step) return;

    const timestamp = new Date().toISOString();
    step.status = status;
    if (status === 'running' && !step.startedAt) step.startedAt = timestamp;
    if (status === 'completed' || status === 'failed') step.finishedAt = timestamp;
    if (message) step.message = message;
  }

  private startStep(job: EmuBuildJob, key: EmuBuildStepKey, message?: string) {
    this.updateStep(job, key, 'running', message);
    this.touch(job, { step: key, message: message || `${key} started` });
  }

  private finishStep(job: EmuBuildJob, key: EmuBuildStepKey, message?: string) {
    this.updateStep(job, key, 'completed', message);
    this.touch(job, { step: key, message: message || `${key} complete` });
  }

  private failStep(job: EmuBuildJob, key: EmuBuildStepKey, message: string) {
    this.updateStep(job, key, 'failed', message);
    this.touch(job, { step: key, message });
  }

  private async cleanupWorkspace(buildRoot: string, completed: boolean) {
    if (!fs.existsSync(buildRoot)) return;

    try {
      if (completed) {
        await fs.promises.rm(buildRoot, { recursive: true, force: true });
      } else {
        await fs.promises.rm(buildRoot, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn('Failed to clean build workspace', error);
    }
  }
}

export const emuBuildJobManager = new EmuBuildJobManager();
