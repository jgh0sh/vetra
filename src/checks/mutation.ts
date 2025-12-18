import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Diff, EvidenceArtifact, VetraConfig } from '../types';
import { newId } from '../utils/ids';
import { execShell } from '../utils/exec';
import { nowIso } from '../utils/time';

type MutationOperator = 'flip_equality' | 'flip_inequality' | 'flip_gt_gte' | 'flip_lt_lte' | 'flip_bool';

function proposeMutations(line: string): Array<{ operator: MutationOperator; mutated: string }> {
  const out: Array<{ operator: MutationOperator; mutated: string }> = [];

  if (line.includes('===')) out.push({ operator: 'flip_equality', mutated: line.replace(/===/g, '!==') });
  if (line.includes('!==')) out.push({ operator: 'flip_inequality', mutated: line.replace(/!==/g, '===') });
  if (line.includes('>')) out.push({ operator: 'flip_gt_gte', mutated: line.replace(/>/g, '>=') });
  if (line.includes('<')) out.push({ operator: 'flip_lt_lte', mutated: line.replace(/</g, '<=') });
  if (/\btrue\b/.test(line)) out.push({ operator: 'flip_bool', mutated: line.replace(/\btrue\b/g, 'false') });
  if (/\bfalse\b/.test(line)) out.push({ operator: 'flip_bool', mutated: line.replace(/\bfalse\b/g, 'true') });

  // Deduplicate
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.mutated) ? false : (seen.add(m.mutated), true)));
}

export async function runDiffScopedMutationTesting(
  headCwd: string,
  diff: Diff,
  config: VetraConfig,
  timeoutMs: number
): Promise<EvidenceArtifact[]> {
  const enabled = config.checks?.mutation?.enabled ?? true;
  if (!enabled) return [];

  const testCommand = config.commands?.test;
  if (!testCommand) return [];

  const maxMutants = config.checks?.mutation?.maxMutants ?? 8;
  const includePathPrefixes = config.checks?.mutation?.includePathPrefixes ?? ['src/'];

  const artifacts: EvidenceArtifact[] = [];
  let attempted = 0;
  let survived = 0;

  for (const file of diff.files) {
    if (attempted >= maxMutants) break;
    const path = file.newPath ?? file.oldPath;
    if (!path) continue;
    if (!includePathPrefixes.some((p) => path.startsWith(p))) continue;
    if (file.language && !['javascript', 'typescript'].includes(file.language)) continue;

    for (const hunk of file.hunks) {
      if (attempted >= maxMutants) break;

      for (const line of hunk.lines) {
        if (attempted >= maxMutants) break;
        if (line.type !== 'add' || !line.newLine) continue;

        const mutations = proposeMutations(line.content);
        if (mutations.length === 0) continue;

        const absPath = resolve(headCwd, path);
        const originalText = await readFile(absPath, 'utf8').catch(() => undefined);
        if (!originalText) continue;
        const lines = originalText.split('\n');
        const idx = line.newLine - 1;
        if (idx < 0 || idx >= lines.length) continue;

        const originalLine = lines[idx];

        for (const mutation of mutations) {
          if (attempted >= maxMutants) break;
          attempted += 1;

          lines[idx] = mutation.mutated;
          await writeFile(absPath, lines.join('\n'), 'utf8');

          const testRes = await execShell(testCommand, { cwd: headCwd, timeoutMs });
          const killed = testRes.exitCode !== 0;
          if (!killed) {
            survived += 1;
            artifacts.push({
              id: newId('artifact_mut'),
              type: 'mutation',
              title: 'Surviving mutant (diff-scoped)',
              summary: `${path}:${line.newLine} ${mutation.operator} survived; consider adding a test/assertion.`,
              createdAt: nowIso(),
              file: path,
              line: line.newLine,
              raw: {
                operator: mutation.operator,
                originalLine,
                mutatedLine: mutation.mutated,
                testCommand,
                testExitCode: testRes.exitCode,
                testStdout: testRes.stdout.slice(0, 10_000),
                testStderr: testRes.stderr.slice(0, 10_000)
              }
            });
          }

          // Restore file content
          lines[idx] = originalLine;
          await writeFile(absPath, lines.join('\n'), 'utf8');
        }
      }
    }
  }

  // If we ran but found nothing, still produce a summary artifact for transparency.
  artifacts.unshift({
    id: newId('artifact_mut_summary'),
    type: 'mutation',
    title: 'Diff-scoped mutation testing summary',
    summary: `Attempted ${attempted} mutants; survived ${survived}.`,
    createdAt: nowIso(),
    raw: { attempted, survived, maxMutants, testCommand }
  });

  return artifacts;
}
