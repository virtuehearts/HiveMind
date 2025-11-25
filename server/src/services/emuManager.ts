import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { config } from '../config';
import { EmuConfig, EmuMetadata, EmuRecord } from '../types';

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
        const notesPath = await this.fileExists(path.join(emuPath, 'notes.md')) ? 'notes.md' : metadata.notesPath;

        const record: EmuRecord = {
          id: metadata.id || baseId,
          name: metadata.name || baseId,
          description: metadata.description,
          tags: metadata.tags || [],
          benchmarkScore: metadata.benchmarkScore,
          path: emuPath,
          notesPath,
          config: configData
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
        notesPath: parsed.notesPath
      };
    } catch (error) {
      console.warn(`Unable to read metadata for ${fallbackId}`, error);
      return { id: fallbackId, tags: [] };
    }
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

