import type { EvidenceArtifact } from '../types';
import { newId } from '../utils/ids';
import { execShell } from '../utils/exec';
import { nowIso } from '../utils/time';

export interface CiCheckResult {
  artifact: EvidenceArtifact;
  ok: boolean;
}

export async function runCiCommand(cwd: string, command: string, timeoutMs: number): Promise<CiCheckResult> {
  const res = await execShell(command, { cwd, timeoutMs });

  const ok = res.exitCode === 0;
  const artifact: EvidenceArtifact = {
    id: newId('artifact_ci'),
    type: 'ci',
    title: ok ? 'CI/tests passed' : 'CI/tests failed',
    summary: ok ? `Command succeeded: ${command}` : `Command failed (${res.exitCode}): ${command}`,
    createdAt: nowIso(),
    raw: {
      command: res.cmd,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      stdout: res.stdout.slice(0, 20_000),
      stderr: res.stderr.slice(0, 20_000)
    }
  };

  return { artifact, ok };
}

