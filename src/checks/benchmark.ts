import type { EvidenceArtifact } from '../types';
import { newId } from '../utils/ids';
import { execShell } from '../utils/exec';
import { nowIso } from '../utils/time';

function parseFirstNumber(text: string): number | undefined {
  const match = /(-?\d+(?:\.\d+)?)/.exec(text);
  if (!match) return undefined;
  return Number(match[1]);
}

export async function runBenchmarkComparison(
  baseCwd: string,
  headCwd: string,
  command: string,
  timeoutMs: number
): Promise<EvidenceArtifact> {
  const [baseRes, headRes] = await Promise.all([
    execShell(command, { cwd: baseCwd, timeoutMs }),
    execShell(command, { cwd: headCwd, timeoutMs })
  ]);

  const baseValue = parseFirstNumber(baseRes.stdout) ?? parseFirstNumber(baseRes.stderr);
  const headValue = parseFirstNumber(headRes.stdout) ?? parseFirstNumber(headRes.stderr);

  const comparable = Number.isFinite(baseValue) && Number.isFinite(headValue);
  const delta = comparable ? (headValue as number) - (baseValue as number) : undefined;
  const absThresholdMs = 5;
  const relThreshold = 0.1; // 10%
  const regression = comparable
    ? (headValue as number) > (baseValue as number) * (1 + relThreshold) && (delta as number) >= absThresholdMs
    : false;

  return {
    id: newId('artifact_bench'),
    type: 'benchmark',
    title: 'Micro-benchmark comparison',
    summary: comparable
      ? `base=${baseValue}, head=${headValue}, delta=${delta} (${regression ? 'regression' : 'ok'})`
      : `Unable to parse numeric benchmark output for: ${command}`,
    createdAt: nowIso(),
    raw: {
      command,
      base: { exitCode: baseRes.exitCode, stdout: baseRes.stdout.slice(0, 10_000), stderr: baseRes.stderr.slice(0, 10_000) },
      head: { exitCode: headRes.exitCode, stdout: headRes.stdout.slice(0, 10_000), stderr: headRes.stderr.slice(0, 10_000) },
      baseValue,
      headValue,
      delta,
      regression
    }
  };
}
