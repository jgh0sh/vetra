#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok) continue;
    if (tok === '-h' || tok === '--help') {
      out.help = true;
      continue;
    }
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith('--')) {
      out[key] = val;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usage() {
  return [
    'node scripts/generate_swrbench_synthetic_data.js [options]',
    '',
    'Options:',
    '  --out-dir <path>     Output root (default: ./.swrbench-synthetic)',
    '  --count <n>          Number of instances (default: 8)',
    '  --clean              Remove existing out-dir first',
    '  --seed <n>           Seed for deterministic ids/dates (default: 42)',
    '  -h, --help           Show help',
    ''
  ].join('\n');
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function writeFile(filePath, contents) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, 'utf8');
}

function git(cwd, args, env) {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...(env ?? {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function initRepo(repoPath) {
  mkdirp(repoPath);
  git(repoPath, ['init']);
  git(repoPath, ['config', 'user.name', 'swrbench-synth']);
  git(repoPath, ['config', 'user.email', 'swrbench-synth@example.com']);
}

function commitAll(repoPath, message, isoDate) {
  git(repoPath, ['add', '-A']);
  git(
    repoPath,
    ['commit', '-m', message],
    isoDate ? { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } : undefined
  );
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function safeRepoDirName(repo) {
  return repo.replace(/\//g, '__');
}

function jsonlWrite(filePath, rows) {
  mkdirp(path.dirname(filePath));
  const lines = rows.map((r) => `${JSON.stringify(r)}\n`).join('');
  fs.writeFileSync(filePath, lines, 'utf8');
}

function seededDate(seed, offsetMinutes) {
  // Deterministic-ish timestamps for stable diffs/logs.
  const baseMs = Date.UTC(2025, 0, 1, 0, 0, 0) + seed * 60_000;
  const ms = baseMs + offsetMinutes * 60_000;
  return new Date(ms).toISOString();
}

function buildScenarios() {
  const scenarios = [];

  // 1) CLEAN: docs + comment tweaks
  scenarios.push({
    repo: 'synthetic/kv-store',
    instanceId: 'synthetic__kv-store-0001',
    prTitle: 'Docs: clarify KvStore key semantics',
    prStatement:
      'Clarifies how keys are treated (case-sensitive) and adds a small usage example. No functional changes intended.',
    changeIntroduced: false,
    baseFiles: {
      'src/kv.ts': [
        'export class KvStore {',
        '  private map = new Map<string, string>();',
        '',
        '  get(key: string): string | undefined {',
        '    return this.map.get(key);',
        '  }',
        '',
        '  set(key: string, value: string): void {',
        '    this.map.set(key, value);',
        '  }',
        '',
        '  delete(key: string): boolean {',
        '    return this.map.delete(key);',
        '  }',
        '}',
        ''
      ].join('\n'),
      'README.md': ['# kv-store', '', 'A tiny in-memory key/value store.', ''].join('\n')
    },
    headFiles: {
      'src/kv.ts': [
        '/**',
        ' * In-memory string KV store.',
        ' *',
        ' * Note: keys are case-sensitive.',
        ' */',
        'export class KvStore {',
        '  private map = new Map<string, string>();',
        '',
        '  get(key: string): string | undefined {',
        '    return this.map.get(key);',
        '  }',
        '',
        '  set(key: string, value: string): void {',
        '    this.map.set(key, value);',
        '  }',
        '',
        '  delete(key: string): boolean {',
        '    return this.map.delete(key);',
        '  }',
        '}',
        ''
      ].join('\n'),
      'README.md': [
        '# kv-store',
        '',
        'A tiny in-memory key/value store.',
        '',
        'Keys are case-sensitive.',
        '',
        '```ts',
        "const store = new KvStore();",
        "store.set('Foo', 'bar');",
        "store.get('foo'); // undefined",
        '```',
        ''
      ].join('\n')
    },
    changes: [],
    reviewBody: 'LGTM.'
  });

  // 2) CLEAN: small refactor, behavior preserved
  scenarios.push({
    repo: 'synthetic/string-utils',
    instanceId: 'synthetic__string-utils-0001',
    prTitle: 'Refactor: simplify whitespace normalization',
    prStatement:
      'Refactors normalizeWhitespace for readability while keeping behavior the same (trim + collapse whitespace).',
    changeIntroduced: false,
    baseFiles: {
      'src/strings.ts': [
        'export function normalizeWhitespace(input: string): string {',
        "  return input.trim().replace(/\\s+/g, ' ');",
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/strings.ts': [
        'export function normalizeWhitespace(input: string): string {',
        '  const trimmed = input.trim();',
        "  if (trimmed === '') return '';",
        "  return trimmed.replace(/\\s+/g, ' ');",
        '}',
        ''
      ].join('\n')
    },
    changes: [],
    reviewBody: 'Looks good.'
  });

  // 3) DEFECT: off-by-one/undercount via Math.floor
  scenarios.push({
    repo: 'synthetic/pagination',
    instanceId: 'synthetic__pagination-0001',
    prTitle: 'Optimize: avoid extra work in pageCount',
    prStatement:
      'Attempts to simplify pageCount to avoid edge-case confusion. Should still return the number of pages needed for the given total.',
    changeIntroduced: true,
    baseFiles: {
      'src/pagination.ts': [
        'export function pageCount(totalItems: number, pageSize: number): number {',
        '  if (pageSize <= 0) return 0;',
        '  if (totalItems <= 0) return 0;',
        '  return Math.ceil(totalItems / pageSize);',
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/pagination.ts': [
        'export function pageCount(totalItems: number, pageSize: number): number {',
        '  if (pageSize <= 0) return 0;',
        '  if (totalItems <= 0) return 0;',
        '  // Use floor to keep the function simple.',
        '  return Math.floor(totalItems / pageSize);',
        '}',
        ''
      ].join('\n')
    },
    changes: [
      {
        change_type: 'F.2',
        change_discussion: {
          discussion_summary:
            'Logic error: using Math.floor undercounts pages when totalItems is not an exact multiple of pageSize (e.g., 1 item with pageSize=10 returns 0).'
        },
        change_introducing: {
          code_snippet: [
            'export function pageCount(totalItems: number, pageSize: number): number {',
            '  if (pageSize <= 0) return 0;',
            '  if (totalItems <= 0) return 0;',
            '  // Use floor to keep the function simple.',
            '  return Math.floor(totalItems / pageSize);',
            '}'
          ].join('\n')
        }
      }
    ],
    reviewBody:
      'This looks incorrect: pageCount should likely use Math.ceil. With Math.floor, totalItems=1,pageSize=10 returns 0 pages.'
  });

  // 4) DEFECT: missing null/undefined guard -> runtime crash
  scenarios.push({
    repo: 'synthetic/user-profile',
    instanceId: 'synthetic__user-profile-0001',
    prTitle: 'Cleanup: simplify displayName formatting',
    prStatement: 'Simplifies displayName by removing intermediate variables. Behavior should be unchanged.',
    changeIntroduced: true,
    baseFiles: {
      'src/user.ts': [
        'export interface User {',
        '  firstName?: string;',
        '  lastName?: string;',
        '}',
        '',
        'export function displayName(user?: User): string {',
        "  if (!user) return 'Anonymous';",
        "  const first = user.firstName?.trim() ?? '';",
        "  const last = user.lastName?.trim() ?? '';",
        "  const full = `${first} ${last}`.trim();",
        "  return full.length > 0 ? full : 'Anonymous';",
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/user.ts': [
        'export interface User {',
        '  firstName?: string;',
        '  lastName?: string;',
        '}',
        '',
        'export function displayName(user?: User): string {',
        "  if (!user) return 'Anonymous';",
        '  // Normalize by trimming and joining.',
        "  const full = `${user.firstName!.trim()} ${user.lastName!.trim()}`.trim();",
        "  return full.length > 0 ? full : 'Anonymous';",
        '}',
        ''
      ].join('\n')
    },
    changes: [
      {
        change_type: 'F.4',
        change_discussion: {
          discussion_summary:
            'Missing checks: non-null assertions on firstName/lastName can throw when either is undefined; the previous implementation handled undefined safely.'
        },
        change_introducing: {
          code_snippet: "const full = `${user.firstName!.trim()} ${user.lastName!.trim()}`.trim();"
        }
      }
    ],
    reviewBody:
      'Potential crash: firstName/lastName are optional but the new code uses non-null assertions and calls trim(). This can throw for users missing a name part.'
  });

  // 5) DEFECT: interface usage bug (swapped args)
  scenarios.push({
    repo: 'synthetic/http-client',
    instanceId: 'synthetic__http-client-0001',
    prTitle: 'Refactor: centralize endpoint building',
    prStatement: 'Moves endpoint construction into a helper to reduce duplication.',
    changeIntroduced: true,
    baseFiles: {
      'src/url.ts': [
        'export function joinUrl(base: string, path: string): string {',
        "  const normalizedBase = base.endsWith('/') ? base : `${base}/`;",
        '  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;',
        '  return normalizedBase + normalizedPath;',
        '}',
        ''
      ].join('\n'),
      'src/client.ts': [
        "import { joinUrl } from './url';",
        '',
        'export function buildUserEndpoint(apiBase: string, userId: string): string {',
        '  return joinUrl(apiBase, `users/${encodeURIComponent(userId)}`);',
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/url.ts': [
        'export function joinUrl(base: string, path: string): string {',
        "  const normalizedBase = base.endsWith('/') ? base : `${base}/`;",
        '  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;',
        '  return normalizedBase + normalizedPath;',
        '}',
        ''
      ].join('\n'),
      'src/client.ts': [
        "import { joinUrl } from './url';",
        '',
        'export function buildUserEndpoint(apiBase: string, userId: string): string {',
        '  const path = `users/${encodeURIComponent(userId)}`;',
        '  // joinUrl handles slashes for us.',
        '  return joinUrl(path, apiBase);',
        '}',
        ''
      ].join('\n')
    },
    changes: [
      {
        change_type: 'F.1',
        change_discussion: {
          discussion_summary:
            'Interface misuse: joinUrl(base, path) is called as joinUrl(path, base), producing malformed URLs and likely breaking requests.'
        },
        change_introducing: {
          code_snippet: 'return joinUrl(path, apiBase);'
        }
      }
    ],
    reviewBody: 'joinUrl takes (base, path). The new call passes (path, base), which will produce incorrect endpoints.'
  });

  // 6) DEFECT: resource leak (fd not closed)
  scenarios.push({
    repo: 'synthetic/config-loader',
    instanceId: 'synthetic__config-loader-0001',
    prTitle: 'Perf: reduce allocations when reading config',
    prStatement: 'Tries to reduce allocations by reading from a file descriptor directly.',
    changeIntroduced: true,
    baseFiles: {
      'src/config.ts': [
        "import { readFileSync } from 'node:fs';",
        '',
        'export function readConfigJson(filePath: string): unknown {',
        "  const raw = readFileSync(filePath, 'utf8');",
        '  return JSON.parse(raw);',
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/config.ts': [
        "import { openSync, readFileSync } from 'node:fs';",
        '',
        'export function readConfigJson(filePath: string): unknown {',
        "  const fd = openSync(filePath, 'r');",
        "  const raw = readFileSync(fd, 'utf8');",
        '  return JSON.parse(raw);',
        '}',
        ''
      ].join('\n')
    },
    changes: [
      {
        change_type: 'F.3',
        change_discussion: {
          discussion_summary:
            'Resource leak: file descriptor opened via openSync is never closed (missing closeSync), which can leak FDs under repeated calls.'
        },
        change_introducing: {
          code_snippet: ["const fd = openSync(filePath, 'r');", "const raw = readFileSync(fd, 'utf8');"].join('\n')
        }
      }
    ],
    reviewBody: 'If you openSync a file descriptor, you should closeSync it (e.g., in a try/finally).'
  });

  // 7) CLEAN: tests only
  scenarios.push({
    repo: 'synthetic/date-utils',
    instanceId: 'synthetic__date-utils-0001',
    prTitle: 'Tests: cover formatIsoDate edge cases',
    prStatement: 'Adds a few basic tests for date formatting. No behavior changes.',
    changeIntroduced: false,
    baseFiles: {
      'src/date.ts': [
        'export function formatIsoDate(date: Date): string {',
        '  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");',
        '  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");',
        '  const dd = String(date.getUTCDate()).padStart(2, "0");',
        '  return `${yyyy}-${mm}-${dd}`;',
        '}',
        ''
      ].join('\n')
    },
    headFiles: {
      'src/date.ts': [
        'export function formatIsoDate(date: Date): string {',
        '  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");',
        '  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");',
        '  const dd = String(date.getUTCDate()).padStart(2, "0");',
        '  return `${yyyy}-${mm}-${dd}`;',
        '}',
        ''
      ].join('\n'),
      'test/date.test.ts': [
        "import { formatIsoDate } from '../src/date';",
        '',
        'function assertEqual(actual: any, expected: any) {',
        '  if (actual !== expected) {',
        '    throw new Error(`Expected ${expected} but got ${actual}`);',
        '  }',
        '}',
        '',
        'assertEqual(formatIsoDate(new Date(Date.UTC(2020, 0, 1))), "2020-01-01");',
        'assertEqual(formatIsoDate(new Date(Date.UTC(1999, 11, 31))), "1999-12-31");',
        ''
      ].join('\n')
    },
    changes: [],
    reviewBody: 'Nice to have more tests.'
  });

  // 8) CLEAN: small perf tweak, behavior preserved
  scenarios.push({
    repo: 'synthetic/ascii',
    instanceId: 'synthetic__ascii-0001',
    prTitle: 'Perf: avoid regex in isAscii',
    prStatement: 'Replaces a regex with a simple loop to reduce allocations on hot paths.',
    changeIntroduced: false,
    baseFiles: {
      'src/ascii.ts': ['export function isAscii(input: string): boolean {', '  return /^[\\x00-\\x7F]*$/.test(input);', '}', ''].join('\n')
    },
    headFiles: {
      'src/ascii.ts': [
        'export function isAscii(input: string): boolean {',
        '  for (let i = 0; i < input.length; i++) {',
        '    if (input.charCodeAt(i) > 0x7f) return false;',
        '  }',
        '  return true;',
        '}',
        ''
      ].join('\n')
    },
    changes: [],
    reviewBody: 'LGTM.'
  });

  return scenarios;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const outDir = typeof args['out-dir'] === 'string' ? args['out-dir'] : path.resolve(process.cwd(), '.swrbench-synthetic');
  const clean = args.clean === true;
  const seed = typeof args.seed === 'string' ? Number(args.seed) || 42 : 42;
  const count = typeof args.count === 'string' ? Math.max(1, Number(args.count) || 1) : 8;

  if (clean) rmrf(outDir);
  mkdirp(outDir);

  const scenarios = buildScenarios().slice(0, count);
  const datasetRows = [];

  const datasetFile = path.join(outDir, 'data', 'swr_datasets_synthetic.jsonl');
  const projectsRoot = path.join(outDir, 'data', 'projects');

  for (let idx = 0; idx < scenarios.length; idx++) {
    const sc = scenarios[idx];
    const repoDir = safeRepoDirName(sc.repo);
    const instanceRoot = path.join(projectsRoot, repoDir, sc.instanceId);

    rmrf(instanceRoot);
    mkdirp(instanceRoot);

    initRepo(instanceRoot);

    for (const [rel, contents] of Object.entries(sc.baseFiles)) {
      writeFile(path.join(instanceRoot, rel), contents);
    }

    const baseDate = seededDate(seed, idx * 10);
    const baseSha = commitAll(instanceRoot, 'Initial commit', baseDate);

    git(instanceRoot, ['branch', 'base_branch', baseSha]);
    git(instanceRoot, ['checkout', '-b', 'branch_under_review', 'base_branch']);

    for (const [rel, contents] of Object.entries(sc.headFiles)) {
      writeFile(path.join(instanceRoot, rel), contents);
    }

    const headDate = seededDate(seed, idx * 10 + 3);
    const headSha = commitAll(instanceRoot, sc.prTitle, headDate);

    // Dataset row follows swrbench-1D0E/swrbench/evaluation_struct.py expectations.
    datasetRows.push({
      repo: sc.repo,
      instance_id: sc.instanceId,
      instance_id_original: sc.instanceId,
      instance_id_human_readable: sc.instanceId,
      instance_id_short: sc.instanceId,
      pr_title: sc.prTitle,
      pr_statement: sc.prStatement,
      change_introduced: Boolean(sc.changeIntroduced),
      changes: Array.isArray(sc.changes) ? sc.changes : [],
      pr_timeline: [
        { type: 'description', created_at: baseDate, user: 'contributor', body: sc.prStatement },
        { type: 'commit', date: headDate, sha: headSha, author: 'contributor', message: sc.prTitle },
        { type: 'review', created_at: headDate, user: 'maintainer', body: sc.reviewBody }
      ],
      // Helpful for debugging.
      _synthetic: { base_branch: baseSha, branch_under_review: headSha }
    });
  }

  jsonlWrite(datasetFile, datasetRows);

  process.stdout.write(
    [
      'Synthetic SWRBench data generated.',
      `out_dir=${outDir}`,
      `dataset_file=${datasetFile}`,
      `repos_dir=${projectsRoot}`,
      `instances=${scenarios.length}`,
      ''
    ].join('\n')
  );
}

main();

