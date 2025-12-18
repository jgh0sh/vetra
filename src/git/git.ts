import { execCommand } from '../utils/exec';
import type { Diff } from '../types';
import { parseUnifiedDiff } from './diff';

export async function git(repoRoot: string, args: string[], timeoutMs?: number) {
  return await execCommand('git', args, { cwd: repoRoot, timeoutMs });
}

export async function getUnifiedDiff(repoRoot: string, baseRef: string, headRef: string): Promise<Diff> {
  const res = await git(repoRoot, ['diff', '--no-color', '--unified=3', `${baseRef}..${headRef}`]);
  if (res.exitCode !== 0) {
    throw new Error(`git diff failed (${res.exitCode}): ${res.stderr || res.stdout}`);
  }
  return parseUnifiedDiff(res.stdout);
}

export async function getCommitMessages(repoRoot: string, baseRef: string, headRef: string): Promise<string[]> {
  const res = await git(repoRoot, ['log', '--format=%s', `${baseRef}..${headRef}`]);
  if (res.exitCode !== 0) {
    throw new Error(`git log failed (${res.exitCode}): ${res.stderr || res.stdout}`);
  }
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

