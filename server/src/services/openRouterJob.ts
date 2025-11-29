import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { QueryGenerationJob, QueryGenerationResult } from '../types';

const decoder = new TextDecoder();

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const defaultPrompt = `You are generating retrieval-friendly training data. For each query, return a short summary plus 2-4 concise Q&A pairs.
Format strictly as:
Summary: <1-3 sentences>
Q&A:
- Q: <question>
  A: <answer>
- Q: <question>
  A: <answer>
Keep answers grounded, avoid filler, and do not include any other text.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStreamedContent(response: Response, targetPath: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response stream available from OpenRouter');
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const fileStream = fs.createWriteStream(targetPath);
  let content = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        const delta: string =
          parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || '';
        if (delta) {
          content += delta;
          fileStream.write(delta);
        }
      } catch (error) {
        // Skip malformed SSE chunks; content will continue streaming.
        continue;
      }
    }
  }

  fileStream.end();
  return content.trim();
}

async function runOpenRouterRequest(
  query: string,
  model: string,
  apiKey: string,
  prompt: string,
  targetPath: string
): Promise<string> {
  const body = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: prompt || defaultPrompt },
      { role: 'user', content: query }
    ]
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  };

  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (response.status === 429 || response.status >= 500) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${text.slice(0, 200)}`);
      }

      return await readStreamedContent(response, targetPath);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown OpenRouter error');
      const delay = Math.min(1200 * attempt, 5000);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Failed to reach OpenRouter');
}

export class OpenRouterJobManager {
  private jobs = new Map<string, QueryGenerationJob>();

  listJobs(): QueryGenerationJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): QueryGenerationJob | undefined {
    return this.jobs.get(id);
  }

  createJob(queries: string[], model: string, apiKey: string, prompt?: string): QueryGenerationJob {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const generatedDir = path.join(config.generatedDir, id);
    const now = new Date().toISOString();

    const job: QueryGenerationJob = {
      id,
      model,
      prompt: prompt || defaultPrompt,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      total: queries.length,
      completed: 0,
      failed: 0,
      generatedDir: path.relative(process.cwd(), generatedDir),
      items: queries.map<QueryGenerationResult>((query, index) => ({
        id: `q-${index + 1}`,
        query,
        status: 'pending'
      }))
    };

    this.jobs.set(id, job);
    this.processJob(job, apiKey);
    return job;
  }

  private async processJob(job: QueryGenerationJob, apiKey: string) {
    job.status = 'running';
    this.touch(job);
    await fs.promises.mkdir(path.join(config.generatedDir, job.id), { recursive: true });

    for (const item of job.items) {
      const queryDir = path.join(config.generatedDir, job.id);
      const targetPath = path.join(queryDir, `${item.id}.txt`);
      item.status = 'running';
      item.startedAt = new Date().toISOString();
      this.touch(job);

      try {
        const content = await runOpenRouterRequest(item.query, job.model, apiKey, job.prompt, targetPath);
        item.response = content;
        item.filePath = path.relative(process.cwd(), targetPath);
        item.status = 'succeeded';
        item.finishedAt = new Date().toISOString();
        job.completed += 1;
      } catch (error) {
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : 'Unknown error';
        item.finishedAt = new Date().toISOString();
        job.failed += 1;
      }

      this.touch(job);
    }

    job.status = job.failed > 0 && job.completed === 0 ? 'failed' : 'completed';
    this.touch(job);
  }

  private touch(job: QueryGenerationJob) {
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, { ...job });
  }
}

export const openRouterJobManager = new OpenRouterJobManager();
