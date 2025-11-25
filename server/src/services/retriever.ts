import fs from 'fs/promises';
import path from 'path';
import { emuManager } from './emuManager';
import { RetrievalResult } from '../types';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function chunkText(text: string, size = 800, overlap = 120): string[] {
  if (size <= 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const slice = text.slice(start, end).trim();
    if (slice) {
      chunks.push(slice);
    }
    if (end === text.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  return chunks;
}

function scoreChunk(queryTokens: string[], chunk: string, tagMatches = 0, keywordWeight = 1): number {
  const chunkTokens = tokenize(chunk);
  const tokenSet = new Set(chunkTokens);
  let score = tagMatches;
  for (const token of queryTokens) {
    if (tokenSet.has(token)) {
      score += 1 * keywordWeight;
    }
  }
  return score;
}

async function readNotesChunks(emuPath: string, notesPath?: string, size?: number, overlap?: number): Promise<string[]> {
  const resolvedPath = notesPath ? path.join(emuPath, notesPath) : path.join(emuPath, 'notes.md');
  try {
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    return chunkText(raw, size, overlap);
  } catch {
    return [];
  }
}

async function readDocumentChunks(
  emuPath: string,
  size?: number,
  overlap?: number
): Promise<{ chunk: string; source: string }[]> {
  const docsFolder = path.join(emuPath, 'docs');
  const chunks: { chunk: string; source: string }[] = [];

  try {
    const entries = await fs.readdir(docsFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(docsFolder, entry.name);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const split = chunkText(raw, size, overlap);
        for (const chunk of split) {
          chunks.push({ chunk, source: entry.name });
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    return [];
  }

  return chunks;
}

export async function retrieve(query: string, topK?: number): Promise<RetrievalResult[]> {
  await emuManager.ensureLoaded();
  const mounted = emuManager.listMounted();
  if (!mounted.length) return [];

  const queryTokens = tokenize(query);
  const scored: RetrievalResult[] = [];

  const configuredTopK = mounted.reduce((max, emu) => Math.max(max, emu.config?.retriever?.topK ?? 0), 0);
  const limit = topK ?? configuredTopK || 5;

  for (const emu of mounted) {
    const chunkSize = emu.config?.chunking?.size;
    const chunkOverlap = emu.config?.chunking?.overlap ?? Math.round((chunkSize || 800) * 0.15);
    const keywordWeight = emu.config?.retriever?.keywordWeight ?? 1;
    const tagMatches = emu.tags
      .map((tag) => tokenize(tag))
      .flat()
      .filter((tag) => queryTokens.includes(tag)).length;

    const noteChunks = await readNotesChunks(emu.path, emu.notesPath, chunkSize, chunkOverlap);
    for (const chunk of noteChunks) {
      const score = scoreChunk(queryTokens, chunk, tagMatches, keywordWeight);
      if (score === 0) continue;
      scored.push({
        emuId: emu.id,
        emuName: emu.name,
        snippet: chunk.slice(0, 420),
        score,
        source: emu.notesPath || 'notes.md'
      });
    }

    const docChunks = await readDocumentChunks(emu.path, chunkSize, chunkOverlap);
    for (const { chunk, source } of docChunks) {
      const score = scoreChunk(queryTokens, chunk, tagMatches, keywordWeight);
      if (score === 0) continue;
      scored.push({
        emuId: emu.id,
        emuName: emu.name,
        snippet: chunk.slice(0, 420),
        score,
        source
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
