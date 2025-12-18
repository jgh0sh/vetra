#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runReview } from './review';
import type { BudgetMode, PullRequestMetadata, VetraConfig } from './types';
import { recordOutcome, recordReview } from './memory/jsonl';
import { HeuristicVerifierModel } from './model/heuristic';
import { OpenAIChatCommentChecker, OpenAIChatVerifierModel } from './model/openai';

function usage(): string {
  return [
    'vetra review [options]',
    'vetra outcome [options]',
    '',
    'Options:',
    '  --repo <path>         Repo root (default: cwd)',
    '  --base <ref>          Base git ref (default: HEAD~1)',
    '  --head <ref>          Head git ref (default: HEAD)',
    '  --title <text>        PR title (default: Local review)',
    '  --desc <text>         PR description',
    '  --config <path>       Path to vetra config JSON (default: <repo>/vetra.config.json if present)',
    '  --budget <mode>       quick|standard|deep',
    '  --model <model>       heuristic|openai (default: heuristic)',
    '  --checker <checker>   none|openai (default: auto)',
    '  --json                Output JSON instead of Markdown',
    '  --no-log              Do not write .vetra/reviews.jsonl',
    '',
    'Outcome options:',
    '  --comment <id>        Comment id to record',
    '  --status <status>     accepted|dismissed|ignored',
    '  --category <cat>      Optional category (tests, correctness, ...)',
    '  -h, --help            Show help',
    ''
  ].join('\n');
}

function parseArgs(argv: string[]): { cmd?: string; flags: Record<string, string | boolean> } {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token) continue;
    if (token === '--json') {
      flags.json = true;
      continue;
    }
    if (token === '-h' || token === '--help') {
      flags.help = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const value = rest[i + 1];
    if (value && !value.startsWith('--')) {
      flags[name] = value;
      i++;
    } else {
      flags[name] = true;
    }
  }

  return { cmd, flags };
}

async function loadConfig(repoRoot: string, configPath?: string): Promise<VetraConfig> {
  const resolved = configPath ? resolve(process.cwd(), configPath) : resolve(repoRoot, 'vetra.config.json');
  if (!existsSync(resolved)) return {};
  const text = await readFile(resolved, 'utf8');
  return JSON.parse(text) as VetraConfig;
}

function parseBudgetMode(mode: unknown): BudgetMode | undefined {
  if (mode === 'quick' || mode === 'standard' || mode === 'deep') return mode;
  return undefined;
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));

  if (flags.help || !cmd) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  if (cmd !== 'review' && cmd !== 'outcome') {
    process.stderr.write(`Unknown command: ${cmd}\n\n${usage()}\n`);
    process.exit(2);
  }

  const repoRoot = typeof flags.repo === 'string' ? resolve(process.cwd(), flags.repo) : process.cwd();
  const baseRef = typeof flags.base === 'string' ? flags.base : 'HEAD~1';
  const headRef = typeof flags.head === 'string' ? flags.head : 'HEAD';

  if (cmd === 'outcome') {
    const commentId = typeof flags.comment === 'string' ? flags.comment : undefined;
    const status = typeof flags.status === 'string' ? flags.status : undefined;
    const category = typeof flags.category === 'string' ? flags.category : undefined;

    if (!commentId || !status) {
      process.stderr.write(`Missing --comment or --status.\n\n${usage()}\n`);
      process.exit(2);
    }

    if (status !== 'accepted' && status !== 'dismissed' && status !== 'ignored') {
      process.stderr.write(`Invalid --status: ${status}\n\n${usage()}\n`);
      process.exit(2);
    }

    await recordOutcome(repoRoot, { commentId, status, category });
    process.stdout.write(`Recorded outcome: ${commentId} => ${status}\n`);
    return;
  }

  const config = await loadConfig(repoRoot, typeof flags.config === 'string' ? flags.config : undefined);

  const meta: PullRequestMetadata = {
    id: 'local',
    title: typeof flags.title === 'string' ? flags.title : 'Local review',
    description: typeof flags.desc === 'string' ? flags.desc : undefined,
    source: 'local'
  };

  const modelName = typeof flags.model === 'string' ? flags.model : 'heuristic';
  const checkerFlag = typeof flags.checker === 'string' ? flags.checker : 'auto';

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.VETRA_OPENAI_BASE_URL;

  const reviewModelName = process.env.VETRA_OPENAI_REVIEW_MODEL ?? process.env.VETRA_OPENAI_MODEL ?? 'gpt-4o-mini';
  const checkerModelName = process.env.VETRA_OPENAI_CHECKER_MODEL ?? 'gpt-4o-mini';

  const model =
    modelName === 'openai'
      ? (() => {
          if (!apiKey) {
            throw new Error('Missing OPENAI_API_KEY (required for --model openai).');
          }
          return new OpenAIChatVerifierModel({ apiKey, model: reviewModelName, baseUrl });
        })()
      : new HeuristicVerifierModel();

  const checker =
    checkerFlag === 'none'
      ? undefined
      : checkerFlag === 'openai' || (checkerFlag === 'auto' && modelName === 'openai')
        ? (() => {
            if (!apiKey) {
              throw new Error('Missing OPENAI_API_KEY (required for --checker openai).');
            }
            return new OpenAIChatCommentChecker({ apiKey, model: checkerModelName, baseUrl });
          })()
        : undefined;

  const result = await runReview({
    repoRoot,
    baseRef,
    headRef,
    meta,
    config,
    budgetMode: parseBudgetMode(flags.budget),
    model,
    checker
  });

  const noLog = flags['no-log'] === true;
  if (!noLog) {
    await recordReview(repoRoot, result);
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(result.summaryMarkdown);
}

main().catch((err) => {
  process.stderr.write(`vetra: ${String(err?.stack ?? err)}\n`);
  process.exit(1);
});
