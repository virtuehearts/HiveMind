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

function scoreChunk(queryTokens: string[], chunk: string): number {
  const chunkTokens = tokenize(chunk);
  const tokenSet = new Set(chunkTokens);
  let score = 0;
  for (const token of queryTokens) {
    if (tokenSet.has(token)) {
      score += 1;
    }
  }
  return score;
}

async function readNotesChunks(emuPath: string, notesPath?: string): Promise<string[]> {
  const resolvedPath = notesPath ? path.join(emuPath, notesPath) : path.join(emuPath, 'notes.md');
  try {
    const raw = await fs.readFile(resolvedPath, 'utf-8');
    return raw
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function retrieve(query: string, topK = 5): Promise<RetrievalResult[]> {
  await emuManager.ensureLoaded();
  const mounted = emuManager.listMounted();
  if (!mounted.length) return [];

  const queryTokens = tokenize(query);
  const scored: RetrievalResult[] = [];

  for (const emu of mounted) {
    const chunks = await readNotesChunks(emu.path, emu.notesPath);
    for (const chunk of chunks) {
      const score = scoreChunk(queryTokens, chunk);
      if (score === 0) continue;
      scored.push({
        emuId: emu.id,
        emuName: emu.name,
        snippet: chunk.slice(0, 420),
        score,
        source: emu.notesPath || 'notes.md'
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
