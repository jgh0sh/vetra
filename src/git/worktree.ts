import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git';

export interface Worktree {
  path: string;
  ref: string;
  cleanup: () => Promise<void>;
}

export async function createWorktree(repoRoot: string, ref: string, label: string): Promise<Worktree> {
  const dir = await mkdtemp(join(tmpdir(), `vetra-${label}-`));

  const res = await git(repoRoot, ['worktree', 'add', '--detach', dir, ref]);
  if (res.exitCode !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`git worktree add failed (${res.exitCode}): ${res.stderr || res.stdout}`);
  }

  return {
    path: dir,
    ref,
    cleanup: async () => {
      await git(repoRoot, ['worktree', 'remove', '--force', dir]).catch(() => undefined);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

