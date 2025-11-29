import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ScrapeJob, ScrapeJobArtifacts, ScrapedChunkRecord } from '../types';

const TOKEN_CHAR_RATIO = 4;
const MIN_TOKENS = 1000;
const MAX_TOKENS = 2000;
const BUILD_ROOT = path.resolve(process.cwd(), '.hivemind', 'builds');

export class ScrapeJobManager {
  private jobs = new Map<string, ScrapeJob>();

  createJob(urls: string[], name?: string): ScrapeJob {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const job: ScrapeJob = {
      id,
      name: name?.trim() || undefined,
      urls,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
      warnings: []
    };

    this.jobs.set(id, job);
    void this.processJob(job);
    return job;
  }

  getJob(id: string): ScrapeJob | undefined {
    return this.jobs.get(id);
  }

  private async processJob(job: ScrapeJob): Promise<void> {
    job.status = 'running';
    job.updatedAt = new Date().toISOString();

    const buildDir = path.join(BUILD_ROOT, job.id);
    const rawDir = path.join(buildDir, 'raw');

    try {
      await fs.promises.mkdir(rawDir, { recursive: true });

      const chunkRecords: ScrapedChunkRecord[] = [];
      let chunkIndex = 1;

      for (const url of job.urls) {
        try {
          const html = await this.fetchHtml(url);
          const cleaned = this.cleanContent(html);

          if (!cleaned) {
            job.warnings?.push(`No readable text found for ${url}`);
            continue;
          }

          const chunks = this.chunkText(cleaned);
          if (!chunks.length) {
            job.warnings?.push(`Content for ${url} was too small to chunk`);
            continue;
          }

          for (const chunk of chunks) {
            const filename = `chunk-${String(chunkIndex).padStart(4, '0')}.txt`;
            const filePath = path.join(rawDir, filename);
            const content = `Source: ${url}\n\n${chunk.trim()}\n`;
            await fs.promises.writeFile(filePath, content, 'utf8');
            const stats = await fs.promises.stat(filePath);

            chunkRecords.push({
              url,
              file: path.relative(buildDir, filePath),
              bytes: stats.size,
              characters: content.length,
              approxTokens: Math.round(content.length / TOKEN_CHAR_RATIO)
            });

            chunkIndex += 1;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Unknown error';
          job.warnings?.push(`Failed to scrape ${url}: ${reason}`);
        }
      }

      if (!chunkRecords.length) {
        throw new Error('No content chunks were created from the provided URLs');
      }

      const manifest = {
        jobId: job.id,
        name: job.name,
        createdAt: job.createdAt,
        updatedAt: new Date().toISOString(),
        urls: job.urls,
        rawDir: path.relative(process.cwd(), rawDir),
        chunks: chunkRecords
      } satisfies ScrapeJobArtifacts;

      const manifestPath = path.join(buildDir, 'manifest.json');
      await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      job.artifacts = {
        ...manifest,
        buildDir: path.relative(process.cwd(), buildDir),
        manifestPath: path.relative(process.cwd(), manifestPath)
      };

      job.status = 'completed';
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Scrape job failed';
      job.updatedAt = new Date().toISOString();
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HiveMindScraper/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Request for ${url} returned status ${response.status}`);
    }

    return await response.text();
  }

  private cleanContent(html: string): string {
    const removableTags = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript', 'svg', 'canvas', 'iframe'];
    let sanitized = html;

    for (const tag of removableTags) {
      const pattern = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
      sanitized = sanitized.replace(pattern, ' ');
    }

    sanitized = sanitized
      .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<div[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ');

    const cleaned = sanitized
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return cleaned;
  }

  private chunkText(text: string): string[] {
    const maxChars = MAX_TOKENS * TOKEN_CHAR_RATIO;
    const minChars = MIN_TOKENS * TOKEN_CHAR_RATIO;
    const sentences = text.split(/(?<=[.!?])\s+/);

    const chunks: string[] = [];
    let current = '';

    const pushCurrent = () => {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
    };

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      const next = current ? `${current} ${trimmed}` : trimmed;

      if (next.length <= maxChars) {
        current = next;
        continue;
      }

      if (current.length >= minChars) {
        pushCurrent();
        current = trimmed;
        continue;
      }

      const broken = this.breakLongText(next, maxChars);
      for (const piece of broken) {
        if (piece.length >= minChars || current.length === 0) {
          chunks.push(piece.trim());
        } else {
          current = current ? `${current} ${piece}` : piece;
        }
      }
      current = '';
    }

    if (current.length && (current.length >= minChars || !chunks.length)) {
      pushCurrent();
    } else if (current.length && chunks.length) {
      const last = chunks.pop();
      if (last) {
        chunks.push(`${last}\n${current}`.trim());
      }
    }

    return chunks;
  }

  private breakLongText(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const pieces: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + maxChars, text.length);
      pieces.push(text.slice(start, end).trim());
      start = end;
    }
    return pieces.filter(Boolean);
  }
}

export const scrapeJobManager = new ScrapeJobManager();
