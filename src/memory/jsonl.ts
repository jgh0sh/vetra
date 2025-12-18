import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewResult } from '../types';
import { nowIso } from '../utils/time';

export type OutcomeStatus = 'accepted' | 'dismissed' | 'ignored';

export interface OutcomeRecord {
  createdAt: string;
  commentId: string;
  status: OutcomeStatus;
  category?: string;
}

function vetraDir(repoRoot: string): string {
  return join(repoRoot, '.vetra');
}

function reviewsPath(repoRoot: string): string {
  return join(vetraDir(repoRoot), 'reviews.jsonl');
}

function outcomesPath(repoRoot: string): string {
  return join(vetraDir(repoRoot), 'outcomes.jsonl');
}

async function ensureDir(repoRoot: string) {
  await mkdir(vetraDir(repoRoot), { recursive: true });
}

export async function recordReview(repoRoot: string, result: ReviewResult): Promise<void> {
  await ensureDir(repoRoot);
  const record = {
    createdAt: nowIso(),
    risk: result.plan.risk,
    budget: result.plan.budget,
    comments: result.comments.map((c) => ({
      id: c.id,
      category: c.category,
      severity: c.severity,
      confidence: c.confidence,
      evidence: c.evidence
    })),
    artifacts: result.artifacts.map((a) => ({ id: a.id, type: a.type, title: a.title, summary: a.summary }))
  };
  await appendFile(reviewsPath(repoRoot), `${JSON.stringify(record)}\n`, 'utf8');
}

export async function recordOutcome(repoRoot: string, outcome: Omit<OutcomeRecord, 'createdAt'>): Promise<void> {
  await ensureDir(repoRoot);
  const record: OutcomeRecord = { createdAt: nowIso(), ...outcome };
  await appendFile(outcomesPath(repoRoot), `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readOutcomes(repoRoot: string): Promise<OutcomeRecord[]> {
  try {
    const text = await readFile(outcomesPath(repoRoot), 'utf8');
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as OutcomeRecord);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}
