import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function sh(cwd: string, cmd: string, args: string[]) {
  await execFileAsync(cmd, args, { cwd });
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'vetra-demo-repo-'));
  try {
    await sh(root, 'git', ['init']);
    await sh(root, 'git', ['config', 'user.email', 'demo@example.com']);
    await sh(root, 'git', ['config', 'user.name', 'Vetra Demo']);

    // Base repo (includes a tiny "knowledge base" in-repo).
    await mkdir(join(root, 'src/auth'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await mkdir(join(root, 'knowledge'), { recursive: true });

    await writeJson(join(root, 'knowledge/issues.json'), {
      'DEMO-123': {
        title: 'Harden auth normalization',
        acceptanceCriteria: [
          'Normalization should be idempotent: f(f(x)) == f(x).',
          'In strict mode, only issuer "internal" is trusted.'
        ],
        url: 'https://example.com/issues/DEMO-123'
      }
    });

    await writeFile(
      join(root, 'knowledge/north-star.md'),
      [
        '# North Star',
        '',
        '- Prefer evidence-backed feedback (tests, traces, benchmarks).',
        '- Minimize noisy comments; be precision-first.',
        '- Protect auth and security-sensitive surfaces.',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'knowledge/architecture.md'),
      [
        '# Architecture Notes',
        '',
        '- `src/auth/*` is security-sensitive.',
        '- Avoid behavior changes without explicit tests.',
        ''
      ].join('\n'),
      'utf8'
    );

    // Vetra config lives in-repo for the demo.
    await writeJson(join(root, 'vetra.config.json'), {
      commands: { test: 'node --test', benchmark: 'node bench.js' },
      checks: {
        metamorphic: {
          enabled: true,
          specs: [
            { module: 'src/auth/normalize.js', export: 'normalizeWhitespace', relation: 'idempotent', input: 'string', samples: 80 }
          ]
        },
        mutation: { enabled: true, maxMutants: 4 },
        benchmark: { enabled: true }
      },
      verifier: { requireEvidenceForHighSeverity: true, maxComments: 10 },
      knowledge: {
        issuesJsonPath: 'knowledge/issues.json',
        northStarMarkdownPath: 'knowledge/north-star.md',
        architectureMarkdownPath: 'knowledge/architecture.md'
      }
    });

    await writeJson(join(root, 'package.json'), {
      name: 'vetra-demo-repo',
      private: true,
      scripts: { test: 'node --test' }
    });

    await writeFile(
      join(root, 'src/auth/normalize.js'),
      [
        'function normalizeWhitespace(s) {',
        "  return String(s).replace(/\\s+/g, ' ').trim();",
        '}',
        '',
        'module.exports = { normalizeWhitespace };',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'test/normalize.test.js'),
      [
        "const test = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const { normalizeWhitespace } = require('../src/auth/normalize');",
        '',
        "test('collapses inner whitespace', () => {",
        "  assert.equal(normalizeWhitespace('a   b'), 'a b');",
        '});',
        '',
        "test('trims ends', () => {",
        "  assert.equal(normalizeWhitespace('  a b  '), 'a b');",
        '});',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'bench.js'),
      [
        '// Prints a numeric value; Vetra parses the first number from stdout/stderr.',
        'const started = Date.now();',
        'let x = 0;',
        'for (let i = 0; i < 2e6; i++) x += i;',
        'const ms = Date.now() - started;',
        'console.log(ms);'
      ].join('\n'),
      'utf8'
    );

    await sh(root, 'git', ['add', '.']);
    await sh(root, 'git', ['commit', '-m', 'base']);
    const base = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

    // Head commit:
    // - Introduce an idempotence regression (metamorphic check will catch it).
    // - Add untested auth logic (diff-scoped mutation will produce surviving mutants).
    // - Make the benchmark meaningfully slower (micro-benchmark will flag regression).
    // - Touch package.json (risk score increases => deeper budget by default).
    await writeJson(join(root, 'package.json'), {
      name: 'vetra-demo-repo',
      private: true,
      description: 'Demo repo for Vetra (auth-sensitive change).',
      scripts: { test: 'node --test' }
    });

    await writeFile(
      join(root, 'src/auth/normalize.js'),
      [
        'function normalizeWhitespace(s) {',
        "  const out = String(s).replace(/\\s+/g, ' ').trim();",
        "  return out + (String(s).endsWith(' ') ? '' : ' ');",
        '}',
        '',
        'function isTrustedIssuer(issuer, mode) {',
        "  if (mode === 'strict') {",
        "    return issuer === 'internal';",
        '  }',
        '  return true;',
        '}',
        '',
        'module.exports = { normalizeWhitespace, isTrustedIssuer };',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'test/normalize.test.js'),
      [
        "const test = require('node:test');",
        "const assert = require('node:assert/strict');",
        "const { normalizeWhitespace } = require('../src/auth/normalize');",
        '',
        "test('collapses inner whitespace', () => {",
        "  assert.equal(normalizeWhitespace('a   b').trim(), 'a b');",
        '});',
        '',
        "test('trims ends', () => {",
        "  assert.equal(normalizeWhitespace('  a b  ').trim(), 'a b');",
        '});',
        ''
      ].join('\n'),
      'utf8'
    );

    await writeFile(
      join(root, 'bench.js'),
      [
        '// Prints a numeric value; Vetra parses the first number from stdout/stderr.',
        'const started = Date.now();',
        'let x = 0;',
        'for (let i = 0; i < 2e7; i++) x += i;',
        'const ms = Date.now() - started;',
        'console.log(ms);'
      ].join('\n'),
      'utf8'
    );

    await sh(root, 'git', ['add', '.']);
    await sh(root, 'git', ['commit', '-m', 'auth changes (demo)']);
    const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

    const vetraCli = join(process.cwd(), 'dist/src/cli.js');
    const commonArgs = [
      vetraCli,
      'review',
      '--no-log',
      '--repo',
      root,
      '--base',
      base,
      '--head',
      head,
      '--title',
      'DEMO-123: Harden auth normalization',
      '--desc',
      'Implements DEMO-123; tests still pass, but deeper checks should catch regressions.'
    ];

    process.stdout.write('=== QUICK REVIEW (override budget) ===\n\n');
    const quick = await execFileAsync('node', [...commonArgs, '--budget', 'quick'], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    process.stdout.write(quick.stdout);
    process.stderr.write(quick.stderr);

    process.stdout.write('\n\n=== AUTO REVIEW (risk-budgeted) ===\n\n');
    const auto = await execFileAsync('node', commonArgs, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    process.stdout.write(auto.stdout);
    process.stderr.write(auto.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err));
  process.exit(1);
});
