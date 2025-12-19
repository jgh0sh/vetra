#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { runReview } from '../src/review';
import type { BudgetMode, PullRequestMetadata, ReviewResult } from '../src/types';
import { HeuristicVerifierModel } from '../src/model/heuristic';
import { OpenAIChatCommentChecker, OpenAIChatVerifierModel } from '../src/model/openai';

type ModelName = 'heuristic' | 'openai';
type CheckerName = 'none' | 'openai';

function usage(): string {
  return [
    'node dist/scripts/swrbench.js --dataset-file <path> --output-file <path> [options]',
    '',
    'Options:',
    '  --repos-dir <path>        Repo root prefix (default: /SWRBench/data/projects)',
    '  --base-ref <ref>          Base ref (default: base_branch)',
    '  --head-ref <ref>          Head ref (default: branch_under_review)',
    '  --budget <mode>           quick|standard|deep (default: standard)',
    '  --model <model>           heuristic|openai (default: openai)',
    '  --checker <checker>       none|openai (default: openai)',
    '  --max-output-comments <n> Max issues emitted per PR (default: 3)',
    '  --num-threads <n>         Concurrency (default: 4)',
    '  --instance-ids <csv>      Only run these instance ids',
    '  --ignore-ids <csv>        Skip these instance ids',
    '  --clean                   Truncate output file before running',
    '  -h, --help                Show help',
    ''
  ].join('\n');
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (token === '-h' || token === '--help') {
      flags.help = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      flags[name] = value;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function buildOpenRouterHeadersFromEnv(): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = process.env.OPENROUTER_HTTP_REFERER ?? process.env.OPENROUTER_SITE_URL;
  const title = process.env.OPENROUTER_X_TITLE ?? process.env.OPENROUTER_APP_NAME;
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-Title'] = title;
  return headers;
}

function parseBudgetMode(value: unknown): BudgetMode | undefined {
  if (value === 'quick' || value === 'standard' || value === 'deep') return value;
  return undefined;
}

function formatSWRBenchReview(result: ReviewResult, maxComments: number): string {
  const lines: string[] = [];
  if (result.comments.length === 0) {
    lines.push('LGTM. No issues found.');
    return lines.join('\n');
  }

  const picked = result.comments.slice(0, Math.max(1, maxComments));
  const high = picked.filter((c) => c.severity === 'high').length;
  lines.push(`Found ${picked.length} issue(s) (${high} high severity).`);
  lines.push('');

  for (const c of picked) {
    const loc =
      c.locations.length > 0 ? ` [${c.locations.map((l) => `${l.file}${l.line ? `:${l.line}` : ''}`).join(', ')}]` : '';
    const ev = c.evidence.length > 0 ? ` (evidence: ${c.evidence.map((e) => e.artifactId).join(', ')})` : '';
    lines.push(`- (${c.severity}/${c.category}) ${c.message}${loc}${ev}`);
    if (c.suggestedFix) lines.push(`  Suggested fix: ${c.suggestedFix}`);
  }

  return lines.join('\n');
}

async function loadProcessedInstanceIds(outputFile: string): Promise<Set<string>> {
  if (!existsSync(outputFile)) return new Set();
  const text = await readFile(outputFile, 'utf8').catch(() => '');
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as any;
      if (typeof obj?.instance_id !== 'string') continue;
      if (typeof obj?.review !== 'string') continue;
      if (obj.review === 'ERROR') continue;
      ids.add(obj.instance_id);
    } catch {
      // Ignore malformed lines.
    }
  }
  return ids;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const datasetFile = typeof flags['dataset-file'] === 'string' ? flags['dataset-file'] : undefined;
  const outputFile = typeof flags['output-file'] === 'string' ? flags['output-file'] : undefined;
  if (!datasetFile || !outputFile) {
    process.stderr.write(`Missing --dataset-file or --output-file.\n\n${usage()}\n`);
    process.exit(2);
  }

  const reposDir = typeof flags['repos-dir'] === 'string' ? flags['repos-dir'] : '/SWRBench/data/projects';
  const baseRef = typeof flags['base-ref'] === 'string' ? flags['base-ref'] : 'base_branch';
  const headRef = typeof flags['head-ref'] === 'string' ? flags['head-ref'] : 'branch_under_review';
  const budgetMode = parseBudgetMode(flags.budget) ?? 'standard';
  const modelName: ModelName = (flags.model === 'heuristic' || flags.model === 'openai' ? flags.model : 'openai') as ModelName;
  const checkerName: CheckerName = (flags.checker === 'none' || flags.checker === 'openai' ? flags.checker : 'openai') as CheckerName;
  const numThreads = typeof flags['num-threads'] === 'string' ? Math.max(1, Number(flags['num-threads']) || 1) : 4;
  const maxOutputComments =
    typeof flags['max-output-comments'] === 'string' ? Math.max(1, Number(flags['max-output-comments']) || 1) : 3;
  const clean = flags.clean === true;

  const onlyInstanceIds = new Set(parseCsv(typeof flags['instance-ids'] === 'string' ? flags['instance-ids'] : undefined) ?? []);
  const ignoreIds = new Set(parseCsv(typeof flags['ignore-ids'] === 'string' ? flags['ignore-ids'] : undefined) ?? []);

  await mkdir(dirname(outputFile), { recursive: true }).catch(() => undefined);
  if (clean) await writeFile(outputFile, '');

  const processed = clean ? new Set<string>() : await loadProcessedInstanceIds(outputFile);

  const apiKeys = parseCsv(process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY);
  const baseUrls =
    parseCsv(
      process.env.VETRA_OPENAI_BASE_URL ?? process.env.OPENAI_API_BASE ?? process.env.OPENROUTER_API_BASE ?? process.env.OPENROUTER_BASE_URL
    ) ?? ['https://openrouter.ai/api/v1'];
  const reviewModelName = process.env.VETRA_OPENAI_REVIEW_MODEL ?? process.env.VETRA_OPENAI_MODEL ?? 'openai/gpt-5.1-codex-max';
  const checkerModelName = process.env.VETRA_OPENAI_CHECKER_MODEL ?? 'openai/gpt-5.1-codex-max';
  const openrouterHeaders = buildOpenRouterHeadersFromEnv();

  const model =
    modelName === 'openai'
      ? (() => {
          if (!apiKeys || apiKeys.length === 0) throw new Error('Missing OPENAI_API_KEY or OPENROUTER_API_KEY (required for --model openai).');
          return new OpenAIChatVerifierModel({ apiKey: apiKeys, model: reviewModelName, baseUrl: baseUrls, headers: openrouterHeaders });
        })()
      : new HeuristicVerifierModel();

  const checker =
    checkerName === 'openai'
      ? (() => {
          if (!apiKeys || apiKeys.length === 0) throw new Error('Missing OPENAI_API_KEY or OPENROUTER_API_KEY (required for --checker openai).');
          return new OpenAIChatCommentChecker({ apiKey: apiKeys, model: checkerModelName, baseUrl: baseUrls, headers: openrouterHeaders });
        })()
      : undefined;

  let writeChain: Promise<void> = Promise.resolve();
  const appendResult = (row: unknown) => {
    writeChain = writeChain.then(() => appendFile(outputFile, `${JSON.stringify(row)}\n`));
    return writeChain;
  };

  const rl = createInterface({ input: createReadStream(datasetFile, 'utf8'), crlfDelay: Infinity });

  const running = new Set<Promise<void>>();

  const schedule = async (fn: () => Promise<void>) => {
    const p = fn()
      .catch(() => undefined)
      .finally(() => {
        running.delete(p);
      });
    running.add(p);
    if (running.size >= numThreads) await Promise.race(running);
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let item: any;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    const instanceId = typeof item?.instance_id === 'string' ? item.instance_id : undefined;
    const repo = typeof item?.repo === 'string' ? item.repo : undefined;
    if (!instanceId || !repo) continue;

    if (onlyInstanceIds.size > 0 && !onlyInstanceIds.has(instanceId)) continue;
    if (ignoreIds.has(instanceId)) continue;
    if (processed.has(instanceId)) continue;

    const title = typeof item?.pr_title === 'string' ? item.pr_title : `SWRBench ${instanceId}`;
    const description = typeof item?.pr_statement === 'string' ? item.pr_statement : undefined;

    const repoPath = join(reposDir, repo.replace(/\//g, '__'), instanceId);

    const meta: PullRequestMetadata = {
      id: instanceId,
      title,
      description,
      source: 'local'
    };

    await schedule(async () => {
      let review = 'ERROR';
      try {
        const result = await runReview({
          repoRoot: repoPath,
          baseRef,
          headRef,
          meta,
          config: {},
          budgetMode,
          model,
          checker
        });
        review = formatSWRBenchReview(result, maxOutputComments);
      } catch (err) {
        review = 'ERROR';
        await appendResult({ instance_id: instanceId, review, error: String((err as any)?.stack ?? err) });
        return;
      }

      await appendResult({ instance_id: instanceId, review });
    });
  }

  await Promise.all(running);
  await writeChain;
}

main().catch((err) => {
  process.stderr.write(String((err as any)?.stack ?? err));
  process.stderr.write('\n');
  process.exit(1);
});
