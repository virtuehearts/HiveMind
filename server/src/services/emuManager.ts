import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import { EmuBlockVersion, EmuConfig, EmuDownloadPayload, EmuMetadata, EmuRecord } from '../types';

const METADATA_FILE = 'metadata.json';
const CONFIG_FILE = 'config.yaml';

class EmuManager {
  private available = new Map<string, EmuRecord>();
  private mounted = new Map<string, EmuRecord>();
  private initialized = false;

  constructor(private readonly emuRoot: string = config.emuRoot) {}

  async ensureLoaded() {
    if (!this.initialized) {
      await this.refreshAvailable();
    }
  }

  async refreshAvailable() {
    this.available.clear();

    try {
      const entries = await fs.readdir(this.emuRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith('.emu')) continue;

        const emuPath = path.join(this.emuRoot, entry.name);
        const baseId = entry.name.replace(/\.emu$/, '');

        const metadata = await this.readMetadata(emuPath, baseId);
        const configData = await this.readConfig(emuPath);
        const notesPath = (await this.fileExists(path.join(emuPath, 'notes.md'))) ? 'notes.md' : metadata.notesPath;

        const record: EmuRecord = {
          id: metadata.id || baseId,
          name: metadata.name || baseId,
          description: metadata.description,
          tags: metadata.tags || [],
          benchmarkScore: metadata.benchmarkScore,
          path: emuPath,
          notesPath,
          config: configData,
          blockVersions: metadata.blockVersions
        };

        this.available.set(record.id, record);
      }
    } catch (error) {
      console.warn('Unable to scan EMU root', error);
    }

    this.initialized = true;
  }

  listAvailable(): EmuRecord[] {
    return Array.from(this.available.values());
  }

  listMounted(): EmuRecord[] {
    return Array.from(this.mounted.values());
  }

  async mount(id: string): Promise<EmuRecord> {
    const record = this.available.get(id);
    if (!record) {
      throw new Error(`EMU ${id} not found`);
    }

    this.mounted.set(id, record);
    return record;
  }

  unmount(id: string) {
    this.mounted.delete(id);
  }

  getRecord(id: string): EmuRecord {
    const record = this.available.get(id);
    if (!record) {
      throw new Error(`EMU ${id} not found`);
    }
    return record;
  }

  async ingestDocument(input: {
    id: string;
    name?: string;
    description?: string;
    tags?: string[];
    notesPath?: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<EmuRecord> {
    const folder = await this.ensureEmuFolder(input.id, {
      id: input.id,
      name: input.name,
      description: input.description,
      tags: input.tags,
      notesPath: input.notesPath
    });

    const docsFolder = path.join(folder, 'docs');
    await fs.mkdir(docsFolder, { recursive: true });
    const filePath = path.join(docsFolder, input.fileName);
    await fs.writeFile(filePath, input.buffer);

    const text = input.buffer.toString('utf-8');
    const sanitized = text.replace(/\r\n/g, '\n');
    const summary = sanitized.slice(0, 240);

    const metadata = await this.readMetadata(folder, input.id);
    const blockVersions: EmuBlockVersion[] = metadata.blockVersions || [];
    const existing = blockVersions.find((block) => block.file === input.fileName);
    if (existing) {
      existing.version += 1;
      existing.updatedAt = new Date().toISOString();
      existing.summary = summary;
    } else {
      blockVersions.push({
        id: `${input.id}-${blockVersions.length + 1}`,
        file: input.fileName,
        version: 1,
        updatedAt: new Date().toISOString(),
        summary
      });
    }

    const notesPath = metadata.notesPath || 'notes.md';
    const notesFile = path.join(folder, notesPath);
    const chunkHeader = `\n\n## Uploaded ${input.fileName} v${existing ? existing.version : 1}\n`;
    await fs.appendFile(notesFile, chunkHeader + sanitized);

    const updatedMetadata: EmuMetadata = { ...metadata, blockVersions };
    await this.writeMetadata(folder, updatedMetadata);
    await this.refreshAvailable();

    const record = this.available.get(input.id);
    if (!record) throw new Error('Unable to refresh EMU after upload');
    record.blockVersions = blockVersions;
    return record;
  }

  async download(id: string): Promise<EmuDownloadPayload> {
    await this.ensureLoaded();
    const record = this.available.get(id);
    if (!record) throw new Error(`EMU ${id} not found`);

    const notesPath = record.notesPath || 'notes.md';
    let notes: string | undefined;
    try {
      notes = await fs.readFile(path.join(record.path, notesPath), 'utf-8');
    } catch {
      notes = undefined;
    }

    const docsFolder = path.join(record.path, 'docs');
    let documents: { file: string; size: number }[] = [];
    try {
      const entries = await fs.readdir(docsFolder, { withFileTypes: true });
      documents = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const stat = await fs.stat(path.join(docsFolder, entry.name));
            return { file: entry.name, size: stat.size };
          })
      );
    } catch {
      documents = [];
    }

    return { emu: record, notes, documents };
  }

  private async ensureEmuFolder(id: string, metadata: Partial<EmuMetadata>) {
    const folder = path.join(this.emuRoot, `${id}.emu`);
    await fs.mkdir(folder, { recursive: true });
    const existing = await this.readMetadata(folder, id);
    const merged: EmuMetadata = {
      ...existing,
      ...metadata,
      id: metadata.id || existing.id || id,
      name: metadata.name || existing.name || id,
      tags: metadata.tags || existing.tags || []
    };
    await this.writeMetadata(folder, merged);
    return folder;
  }

  private async readMetadata(emuPath: string, fallbackId: string): Promise<EmuMetadata> {
    const metadataPath = path.join(emuPath, METADATA_FILE);
    try {
      const raw = await fs.readFile(metadataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        id: parsed.id || fallbackId,
        name: parsed.name,
        description: parsed.description,
        tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
        benchmarkScore: typeof parsed.benchmarkScore === 'number' ? parsed.benchmarkScore : undefined,
        notesPath: parsed.notesPath,
        blockVersions: Array.isArray(parsed.blockVersions)
          ? parsed.blockVersions.map((block: EmuBlockVersion) => ({
              id: block.id,
              file: block.file,
              version: block.version,
              updatedAt: block.updatedAt,
              summary: block.summary
            }))
          : undefined
      };
    } catch (error) {
      console.warn(`Unable to read metadata for ${fallbackId}`, error);
      return { id: fallbackId, tags: [] };
    }
  }

  private async writeMetadata(emuPath: string, metadata: EmuMetadata) {
    const metadataPath = path.join(emuPath, METADATA_FILE);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private async readConfig(emuPath: string): Promise<EmuConfig | undefined> {
    const configPath = path.join(emuPath, CONFIG_FILE);
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const parsed = yaml.load(raw) as EmuConfig;
      return parsed;
    } catch (error) {
      console.warn(`Unable to read config for ${emuPath}`, error);
      return undefined;
    }
  }

  private async fileExists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const emuManager = new EmuManager();
