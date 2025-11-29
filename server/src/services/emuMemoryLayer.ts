import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  EmuMount,
  MemoryBlock,
  MemoryBlockUpdatePayload,
  MemoryIndex,
  MemoryStatus,
  NewMemoryBlockPayload
} from '../types';
import AdmZip from 'adm-zip';

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'have',
  'this',
  'from',
  'your',
  'about',
  'like',
  'just',
  'into',
  'into',
  'there',
  'their',
  'what',
  'when',
  'where',
  'would',
  'could',
  'should'
]);

interface Classification {
  intent: string;
  tags: string[];
  summary: string;
  score: number;
}

interface EmuMetadata {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  benchmarkScore?: number;
  notesPath?: string;
}

interface EmuChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

interface MemoryLayerOptions {
  storePath?: string;
  emuBasePath?: string;
}

type MetadataOverride = MemoryBlockUpdatePayload & { updatedAt?: string };

export class EmuMemoryLayer {
  private storePath: string;
  private emuBasePath: string;
  private userBlocks: MemoryBlock[] = [];
  private emuBlocks: MemoryBlock[] = [];
  private emuMounts: EmuMount[] = [];
  private index: MemoryIndex = { byIntent: {}, byTag: {} };
  private hiddenBlockIds = new Set<string>();
  private metadataOverrides: Record<string, MetadataOverride> = {};

  constructor(options?: MemoryLayerOptions) {
    this.storePath =
      options?.storePath || path.resolve(process.cwd(), '.hivemind', 'emu-memory.json');
    this.emuBasePath = options?.emuBasePath || path.resolve(process.cwd(), 'emus');
    this.load();
    this.loadEmuMounts();
    this.rebuildIndex();
  }

  listEmuMounts(): EmuMount[] {
    return [...this.emuMounts].sort((a, b) => a.name.localeCompare(b.name));
  }

  refreshEmuMounts() {
    this.loadEmuMounts();
    this.rebuildIndex();
  }

  listBlocks(): MemoryBlock[] {
    return this.getAllBlocks().sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  }

  getBlock(id: string): MemoryBlock | null {
    return this.getAllBlocks().find((block) => block.id === id) || null;
  }

  updateBlock(id: string, updates: MemoryBlockUpdatePayload): MemoryBlock {
    const allowedUpdates: MemoryBlockUpdatePayload = {
      title: updates.title?.trim(),
      tags: this.normalizeStringList(updates.tags),
      labels: this.normalizeStringList(updates.labels),
      notes: updates.notes?.trim(),
      genre: updates.genre?.trim(),
      isPrivate: updates.isPrivate,
      relevance: this.coerceScore(updates.relevance),
      overallScore: this.coerceScore(updates.overallScore)
    };

    const cleanUpdate: MemoryBlockUpdatePayload = Object.fromEntries(
      Object.entries(allowedUpdates).filter(([, value]) => value !== undefined)
    ) as MemoryBlockUpdatePayload;

    const inUserStore = this.userBlocks.find((block) => block.id === id);
    if (inUserStore) {
      Object.assign(inUserStore, cleanUpdate, { updatedAt: new Date().toISOString() });
      this.rebuildIndex();
      this.persist();
      return this.applyOverrides(inUserStore);
    }

    const emuBlock = this.emuBlocks.find((block) => block.id === id);
    if (!emuBlock) {
      throw new Error('Memory block not found');
    }

    this.metadataOverrides[id] = {
      ...this.metadataOverrides[id],
      ...cleanUpdate,
      updatedAt: new Date().toISOString()
    };
    this.rebuildIndex();
    this.persist();
    return this.applyOverrides(emuBlock);
  }

  deleteBlock(id: string): boolean {
    const initialLength = this.userBlocks.length;
    this.userBlocks = this.userBlocks.filter((block) => block.id !== id);
    if (this.userBlocks.length !== initialLength) {
      this.rebuildIndex();
      this.persist();
      return true;
    }

    const existsInEmu = this.emuBlocks.some((block) => block.id === id);
    if (existsInEmu) {
      this.hiddenBlockIds.add(id);
      this.rebuildIndex();
      this.persist();
      return true;
    }

    return false;
  }

  getStatus(): MemoryStatus {
    const intentEntries = Object.entries(this.index.byIntent).map(([intent, ids]) => ({
      intent,
      count: ids.length
    }));

    const tagEntries = Object.entries(this.index.byTag)
      .map(([tag, ids]) => ({ tag, count: ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((entry) => entry.tag);

    const allBlocks = this.getAllBlocks();
    const lastUpdated = allBlocks
      .map((block) => block.updatedAt)
      .sort((a, b) => (a > b ? -1 : 1))[0];

    const storagePath = [
      `${this.storePath} (user memories)`,
      fs.existsSync(this.emuBasePath) ? `${this.emuBasePath} (mounted EMUs)` : undefined
    ]
      .filter(Boolean)
      .join(' + ');

    return {
      totalBlocks: allBlocks.length,
      intents: intentEntries.sort((a, b) => b.count - a.count),
      topTags: tagEntries,
      storagePath,
      lastUpdated: lastUpdated ?? null,
      index: this.index
    };
  }

  addBlock(payload: NewMemoryBlockPayload): MemoryBlock {
    const content = payload.content.trim();
    if (!content) {
      throw new Error('Memory content is required');
    }

    const tags = this.normalizeStringList(payload.tags);
    const labels = this.normalizeStringList(payload.labels);
    const classification = this.classify(content, payload.title, tags);
    const timestamp = new Date().toISOString();

    const block: MemoryBlock = {
      id: crypto.randomUUID(),
      title: payload.title?.trim() || classification.intent,
      content,
      intent: classification.intent,
      tags: classification.tags,
      labels,
      notes: payload.notes?.trim(),
      genre: payload.genre?.trim(),
      isPrivate: payload.isPrivate ?? true,
      relevance: this.coerceScore(payload.relevance),
      overallScore: this.coerceScore(payload.overallScore),
      source: payload.source || 'personal',
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: classification.summary,
      score: classification.score,
      size: Buffer.byteLength(content, 'utf-8')
    };

    this.userBlocks = [block, ...this.userBlocks];
    this.rebuildIndex();
    this.persist();

    return block;
  }

  findRelevantBlocks(
    query: string,
    options?: { intents?: string[]; tags?: string[]; limit?: number }
  ): MemoryBlock[] {
    const tokens = this.tokenize(query);
    const tagSet = new Set((options?.tags || []).map((tag) => tag.toLowerCase()));
    const intentSet = new Set((options?.intents || []).map((intent) => intent.toLowerCase()));

    const scored = this.getAllBlocks()
      .map((block) => {
        const blockTags = block.tags.map((tag) => tag.toLowerCase());
        const tagMatches = blockTags.filter((tag) => tokens.has(tag) || tagSet.has(tag)).length;
        const intentBoost = intentSet.size && intentSet.has(block.intent.toLowerCase()) ? 2 : 0;

        const contentMatches = Array.from(tokens).filter((token) => block.content.toLowerCase().includes(token)).length;
        const score = intentBoost + tagMatches * 1.5 + contentMatches * 0.5 + block.score;

        return { block, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit || 4)
      .map((entry) => entry.block);

    return scored;
  }

  exportEmuArchive(id: string): { filename: string; buffer: Buffer } {
    const mount = this.emuMounts.find(
      (entry) => entry.id === id || path.basename(entry.path).replace(/\.emu$/, '') === id
    );

    if (!mount) {
      throw new Error('EMU not found');
    }

    if (!fs.existsSync(mount.path)) {
      throw new Error('EMU directory is missing on disk');
    }

    const folderName = path.basename(mount.path);
    const zip = new AdmZip();
    zip.addLocalFolder(mount.path, folderName);

    return { filename: `${folderName}.zip`, buffer: zip.toBuffer() };
  }

  importEmuArchive(buffer: Buffer, originalName?: string): EmuMount {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    if (!entries.length) {
      throw new Error('Archive was empty');
    }

    const rootCandidates = new Set<string>(
      entries
        .map((entry: AdmZip.IZipEntry) => entry.entryName.replace(/\\/g, '/').split('/')[0] || '')
        .filter((name): name is string => Boolean(name))
    );

    let targetFolder: string | undefined = Array.from(rootCandidates).find((name) => name.endsWith('.emu'));
    if (!targetFolder) {
      const safeBase = (originalName?.replace(/\.(zip|emu)$/i, '') || 'upload').replace(
        /[^a-zA-Z0-9_-]/g,
        '-'
      );
      targetFolder = `${safeBase}.emu`;
    }

    targetFolder = targetFolder.replace(/[^a-zA-Z0-9._-]/g, '-');
    if (!targetFolder.endsWith('.emu')) {
      targetFolder = `${targetFolder}.emu`;
    }

    const destRoot = path.join(this.emuBasePath, targetFolder);
    fs.mkdirSync(this.emuBasePath, { recursive: true });
    fs.rmSync(destRoot, { recursive: true, force: true });

    for (const entry of entries) {
      const normalized = entry.entryName.replace(/\\/g, '/');
      if (normalized.includes('..')) {
        throw new Error('EMU archive contains invalid paths');
      }

      const relativePath = normalized.startsWith(targetFolder)
        ? normalized
        : path.join(targetFolder, normalized);
      const destPath = path.join(this.emuBasePath, relativePath);

      if (entry.isDirectory) {
        fs.mkdirSync(destPath, { recursive: true });
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.getData());
    }

    this.refreshEmuMounts();
    const folderId = targetFolder.replace(/\.emu$/, '');
    const mounted =
      this.emuMounts.find((mount) => mount.id === folderId) ||
      this.emuMounts.find((mount) => path.basename(mount.path) === targetFolder);

    if (!mounted) {
      throw new Error('EMU was extracted but could not be indexed');
    }

    return mounted;
  }

  private getAllBlocks(): MemoryBlock[] {
    return [...this.emuBlocks, ...this.userBlocks]
      .filter((block) => !this.hiddenBlockIds.has(block.id))
      .map((block) => this.applyOverrides(block));
  }

  private applyOverrides(block: MemoryBlock): MemoryBlock {
    const override = this.metadataOverrides[block.id];
    const merged = override ? { ...block, ...override } : block;
    return {
      ...merged,
      size: Buffer.byteLength(merged.content, 'utf-8'),
      tags: this.normalizeStringList(merged.tags),
      labels: this.normalizeStringList(merged.labels)
    };
  }

  private classify(content: string, title?: string, userTags?: string[]): Classification {
    const text = `${title || ''} ${content}`.toLowerCase();

    const rules: { intent: string; keywords: RegExp[] }[] = [
      { intent: 'task', keywords: [/\b(todo|task|remind|schedule)\b/] },
      { intent: 'goal', keywords: [/\bgoal\b/, /\bplan\b/, /\bmission\b/] },
      { intent: 'identity', keywords: [/\bi am\b/, /\bmy name\b/, /\bi work\b/] },
      { intent: 'preference', keywords: [/\bi like\b/, /\bi love\b/, /\bi prefer\b/] },
      { intent: 'memory', keywords: [/\bremember\b/, /\brecall\b/, /\bnote\b/] },
      { intent: 'event', keywords: [/\btoday\b/, /\byesterday\b/, /\bmeeting\b/, /\bcall\b/] },
      { intent: 'fact', keywords: [/\bnumber\b/, /\bdate\b/, /\bfact\b/] }
    ];

    let intent = 'note';
    for (const rule of rules) {
      if (rule.keywords.some((keyword) => keyword.test(text))) {
        intent = rule.intent;
        break;
      }
    }

    const autoTags = new Set<string>(['emu', 'personal']);
    const tokens = text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens) {
      if (token.length < 4 || STOP_WORDS.has(token)) continue;
      autoTags.add(token);
    }

    if (userTags?.length) {
      for (const tag of userTags) {
        if (tag.trim()) autoTags.add(tag.trim().toLowerCase());
      }
    }

    const summary = content.length > 140 ? `${content.slice(0, 137)}...` : content;
    const score = Math.min(1, (autoTags.size + tokens.length / 50) / 10);

    return {
      intent,
      tags: Array.from(autoTags),
      summary,
      score
    };
  }

  private tokenize(text: string): Set<string> {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));

    return new Set(tokens);
  }

  private rebuildIndex() {
    const byIntent: Record<string, string[]> = {};
    const byTag: Record<string, string[]> = {};

    for (const block of this.getAllBlocks()) {
      byIntent[block.intent] = byIntent[block.intent] || [];
      byIntent[block.intent].push(block.id);

      for (const tag of block.tags) {
        byTag[tag] = byTag[tag] || [];
        byTag[tag].push(block.id);
      }
    }

    this.index = { byIntent, byTag };
  }

  private persist() {
    const dir = path.dirname(this.storePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      blocks: this.userBlocks,
      overrides: this.metadataOverrides,
      hidden: Array.from(this.hiddenBlockIds)
    };
    fs.writeFileSync(this.storePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private load() {
    try {
      if (!fs.existsSync(this.storePath)) {
        this.userBlocks = [];
        this.index = { byIntent: {}, byTag: {} };
        return;
      }

      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.userBlocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      this.metadataOverrides = parsed.overrides || {};
      this.hiddenBlockIds = new Set<string>(parsed.hidden || []);
    } catch (error) {
      console.warn('Failed to load EMU memory store, starting empty.', error);
      this.userBlocks = [];
      this.index = { byIntent: {}, byTag: {} };
    }
  }

  private loadEmuMounts() {
    this.emuBlocks = [];
    this.emuMounts = [];
    if (!fs.existsSync(this.emuBasePath)) return;

    const entries = fs.readdirSync(this.emuBasePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('.emu')) continue;

      const emuPath = path.join(this.emuBasePath, entry.name);
      const meta = this.readMetadata(emuPath);
      const chunking = this.parseChunkingConfig(path.join(emuPath, 'config.yaml'));
      const notesPath = meta.notesPath || 'notes.md';
      const notesFile = path.join(emuPath, notesPath);

      if (!fs.existsSync(notesFile)) {
        console.warn(`EMU ${entry.name} is missing ${notesPath}; skipping.`);
        continue;
      }

      const content = fs.readFileSync(notesFile, 'utf-8');
      const blocks = this.chunkContent(content, chunking);
      const timestamp = new Date().toISOString();
      const emuId = meta.id || entry.name.replace(/\.emu$/, '');
      const baseTitle = meta.name || emuId;
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      const labels = Array.isArray(meta.tags) ? meta.tags : [];

      let blockCount = 0;
      let totalSize = 0;

      blocks.forEach((chunk, index) => {
        const classification = this.classify(chunk, baseTitle, tags);
        const chunkSize = Buffer.byteLength(chunk, 'utf-8');
        this.emuBlocks.push({
          id: `emu-${emuId}-${index}`,
          title: `${baseTitle} #${index + 1}`,
          content: chunk,
          intent: classification.intent,
          tags: Array.from(new Set([...classification.tags, ...tags])),
          labels,
          source: `emu:${emuId}`,
          createdAt: timestamp,
          updatedAt: timestamp,
          summary: classification.summary,
          score: Math.max(classification.score, meta.benchmarkScore || 0),
          size: chunkSize
        });

        blockCount += 1;
        totalSize += chunkSize;
      });

      const emuStats = fs.statSync(emuPath);
      this.emuMounts.push({
        id: emuId,
        name: baseTitle,
        description: meta.description,
        tags,
        path: emuPath,
        blockCount,
        sizeBytes: totalSize,
        lastModified: emuStats.mtime.toISOString()
      });
    }
  }

  private readMetadata(emuPath: string): EmuMetadata {
    const metaPath = path.join(emuPath, 'metadata.json');
    try {
      if (!fs.existsSync(metaPath)) return {};
      const raw = fs.readFileSync(metaPath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`Failed to parse metadata for ${emuPath}`, error);
      return {};
    }
  }

  private parseChunkingConfig(configPath: string): EmuChunkingConfig {
    const defaults: EmuChunkingConfig = { chunkSize: 512, chunkOverlap: 64 };
    try {
      if (!fs.existsSync(configPath)) return defaults;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const sizeMatch = raw.match(/chunking:\s*[\r\n]+\s*size:\s*(\d+)/i);
      const overlapMatch = raw.match(/overlap:\s*(\d+)/i);
      return {
        chunkSize: sizeMatch ? Number(sizeMatch[1]) || defaults.chunkSize : defaults.chunkSize,
        chunkOverlap: overlapMatch ? Number(overlapMatch[1]) || defaults.chunkOverlap : defaults.chunkOverlap
      };
    } catch (error) {
      console.warn('Failed to parse EMU chunking config; using defaults.', error);
      return defaults;
    }
  }

  private chunkContent(content: string, config: EmuChunkingConfig): string[] {
    const cleaned = content.replace(/\r\n/g, '\n').trim();
    if (!cleaned) return [];

    const paragraphs = cleaned.split(/\n\s*\n/);
    const chunks: string[] = [];

    for (const paragraph of paragraphs) {
      const text = paragraph.trim();
      if (!text) continue;

      if (text.length <= config.chunkSize) {
        chunks.push(text);
        continue;
      }

      let start = 0;
      while (start < text.length) {
        const end = Math.min(text.length, start + config.chunkSize);
        chunks.push(text.slice(start, end));
        if (end === text.length) break;
        start = end - config.chunkOverlap;
      }
    }

    return chunks;
  }

  private normalizeStringList(value?: string[] | string): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((entry) => entry.trim()).filter(Boolean);
    }

    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private coerceScore(value?: number): number | undefined {
    if (value === undefined || value === null || Number.isNaN(value)) return undefined;
    return Math.max(0, Math.min(1, Number(value)));
  }
}
