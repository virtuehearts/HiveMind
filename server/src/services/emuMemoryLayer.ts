import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MemoryBlock, MemoryIndex, MemoryStatus, NewMemoryBlockPayload } from '../types';

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

export class EmuMemoryLayer {
  private storePath: string;
  private blocks: MemoryBlock[] = [];
  private index: MemoryIndex = { byIntent: {}, byTag: {} };

  constructor(storePath?: string) {
    this.storePath = storePath || path.resolve(__dirname, '..', 'data', 'emu-memory.json');
    this.load();
  }

  listBlocks(): MemoryBlock[] {
    return [...this.blocks];
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

    return {
      totalBlocks: this.blocks.length,
      intents: intentEntries.sort((a, b) => b.count - a.count),
      topTags: tagEntries,
      storagePath: this.storePath,
      lastUpdated: this.blocks[0]?.createdAt ?? null,
      index: this.index
    };
  }

  addBlock(payload: NewMemoryBlockPayload): MemoryBlock {
    const content = payload.content.trim();
    if (!content) {
      throw new Error('Memory content is required');
    }

    const classification = this.classify(content, payload.title, payload.tags);
    const timestamp = new Date().toISOString();

    const block: MemoryBlock = {
      id: crypto.randomUUID(),
      title: payload.title?.trim() || classification.intent,
      content,
      intent: classification.intent,
      tags: classification.tags,
      source: payload.source || 'personal',
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: classification.summary,
      score: classification.score
    };

    this.blocks = [block, ...this.blocks];
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

    const scored = this.blocks
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

    for (const block of this.blocks) {
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
    fs.writeFileSync(this.storePath, JSON.stringify({ blocks: this.blocks }, null, 2), 'utf-8');
  }

  private load() {
    try {
      if (!fs.existsSync(this.storePath)) {
        this.blocks = [];
        this.index = { byIntent: {}, byTag: {} };
        return;
      }

      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      this.rebuildIndex();
    } catch (error) {
      console.warn('Failed to load EMU memory store, starting empty.', error);
      this.blocks = [];
      this.index = { byIntent: {}, byTag: {} };
    }
  }
}
