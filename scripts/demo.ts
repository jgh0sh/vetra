import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPullRequestContext } from '../src/context/build';
import { runBenchmarkComparison } from '../src/checks/benchmark';
import { runCiCommand } from '../src/checks/ci';
import { runMetamorphicChecks } from '../src/checks/metamorphic';
import { runDiffScopedMutationTesting } from '../src/checks/mutation';
import { createWorktree } from '../src/git/worktree';
import { formatReviewMarkdown } from '../src/format/markdown';
import { planReview } from '../src/planner/planner';
import { HeuristicVerifierModel } from '../src/model/heuristic';
import { verifyAndRankComments } from '../src/verifier/verifier';
import type { BudgetMode, EvidenceArtifact, PlanAction, PullRequestContext, ReviewComment, ReviewPlan, VetraConfig } from '../src/types';

const execFileAsync = promisify(execFile);

async function sh(cwd: string, cmd: string, args: string[]) {
  await execFileAsync(cmd, args, { cwd });
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

const SEP = '='.repeat(80);

function section(title: string) {
  process.stdout.write(`\n${SEP}\n${title}\n${SEP}\n`);
}

function json(label: string, value: unknown) {
  process.stdout.write(`${label}:\n${JSON.stringify(value, null, 2)}\n`);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarizeDiff(context: PullRequestContext) {
  const files = context.diff.files.map((f) => {
    const path = f.newPath ?? f.oldPath ?? '(unknown)';
    return { file: path, additions: f.additions, deletions: f.deletions, hunks: f.hunks.length, language: f.language ?? null };
  });
  return {
    filesChanged: context.diff.files.length,
    linesAdded: context.diff.files.reduce((sum, f) => sum + f.additions, 0),
    linesDeleted: context.diff.files.reduce((sum, f) => sum + f.deletions, 0),
    files
  };
}

function renderUnifiedDiff(context: PullRequestContext): string {
  const out: string[] = [];
  for (const file of context.diff.files) {
    const path = file.newPath ?? file.oldPath ?? '(unknown)';
    out.push(`File: ${path} (+${file.additions}/-${file.deletions})`);
    for (const hunk of file.hunks) {
      out.push(hunk.header);
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        out.push(`${prefix}${line.content}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function formatArtifact(a: EvidenceArtifact): string {
  const loc = a.file ? ` (${a.file}${a.line ? `:${a.line}` : ''})` : '';
  return `- [${a.type}] ${a.id}${loc}: ${a.title} — ${a.summary}`;
}

function formatAction(a: PlanAction): string {
  return `- [${a.kind}] ${a.id} (cost=${a.estimatedCost}): ${a.description}`;
}

function formatComment(c: ReviewComment): string {
  const loc =
    c.locations.length > 0 ? ` locations=[${c.locations.map((l) => `${l.file}${l.line ? `:${l.line}` : ''}`).join(', ')}]` : '';
  const ev = c.evidence.length > 0 ? ` evidence=[${c.evidence.map((e) => e.artifactId).join(', ')}]` : ' evidence=[]';
  return `- [${c.id}] (${c.severity}/${c.category}/${c.confidence}) ${c.message}${loc}${ev}`;
}

function summarizeArtifacts(artifacts: EvidenceArtifact[]) {
  const counts: Record<string, number> = {};
  for (const a of artifacts) counts[a.type] = (counts[a.type] ?? 0) + 1;
  return { total: artifacts.length, byType: counts };
}

async function executeWithTrace(context: PullRequestContext, plan: ReviewPlan, config: VetraConfig, label: string) {
  section(`${label} — STEP 3: Executor (run checks + collect evidence + propose comments)`);

  const model = new HeuristicVerifierModel();

  const needsHead =
    plan.actions.some((a) => a.kind === 'run_ci' || a.kind === 'mutation' || a.kind === 'metamorphic' || a.kind === 'benchmark') ||
    Boolean(config.commands?.test) ||
    Boolean(config.commands?.benchmark);
  const needsBase = plan.actions.some((a) => a.kind === 'benchmark' || a.kind === 'metamorphic');

  process.stdout.write(`Worktrees: needsBase=${needsBase}, needsHead=${needsHead}\n`);

  const headWorktree = needsHead ? await createWorktree(context.repoRoot, context.headRef, 'demo-head') : undefined;
  const baseWorktree = needsBase ? await createWorktree(context.repoRoot, context.baseRef, 'demo-base') : undefined;

  if (baseWorktree) process.stdout.write(`Created base worktree: ${baseWorktree.path} @ ${baseWorktree.ref}\n`);
  if (headWorktree) process.stdout.write(`Created head worktree: ${headWorktree.path} @ ${headWorktree.ref}\n`);

  let candidateComments: ReviewComment[] = [];

  try {
    for (const action of plan.actions) {
      const started = Date.now();
      const artifactsBefore = context.artifacts.length;

      section(`${label} — EXEC ACTION: ${action.kind}`);
      process.stdout.write(`${formatAction(action)}\n`);

      if (action.kind === 'gather_context') {
        process.stdout.write('Result: already done (context is built before planning).\n');
      } else if (action.kind === 'retrieve_knowledge') {
        process.stdout.write('Result: already done (knowledge is loaded during context build).\n');
      } else if (action.kind === 'run_ci') {
        if (!config.commands?.test || !headWorktree) {
          process.stdout.write('Result: skipped (missing config.commands.test or head worktree).\n');
        } else {
          const { artifact, ok } = await runCiCommand(headWorktree.path, config.commands.test, plan.budget.timeoutMs);
          context.artifacts.push(artifact);
          process.stdout.write(`Result: ${ok ? 'PASS' : 'FAIL'}\n`);
          process.stdout.write(`${formatArtifact(artifact)}\n`);
        }
      } else if (action.kind === 'metamorphic') {
        if (!baseWorktree || !headWorktree) {
          process.stdout.write('Result: skipped (missing base/head worktrees).\n');
        } else {
          const artifacts = await runMetamorphicChecks(baseWorktree.path, headWorktree.path, context.diff, config);
          context.artifacts.push(...artifacts);
          const regressions = artifacts.filter((a) => a.type === 'metamorphic' && /regression/i.test(a.title));
          process.stdout.write(`Result: produced ${artifacts.length} artifact(s), regressions=${regressions.length}\n`);
          for (const a of artifacts) process.stdout.write(`${formatArtifact(a)}\n`);
        }
      } else if (action.kind === 'mutation') {
        if (!headWorktree) {
          process.stdout.write('Result: skipped (missing head worktree).\n');
        } else {
          const artifacts = await runDiffScopedMutationTesting(headWorktree.path, context.diff, config, plan.budget.timeoutMs);
          context.artifacts.push(...artifacts);
          const summary = artifacts.find((a) => a.type === 'mutation' && /summary/i.test(a.title));
          const survivors = artifacts.filter((a) => a.type === 'mutation' && /Surviving mutant/i.test(a.title));
          process.stdout.write(
            `Result: produced ${artifacts.length} artifact(s), survivingMutants=${survivors.length}${summary?.raw ? '' : ' (no summary?)'}\n`
          );
          for (const a of artifacts) process.stdout.write(`${formatArtifact(a)}\n`);
        }
      } else if (action.kind === 'benchmark') {
        if (!baseWorktree || !headWorktree || !config.commands?.benchmark) {
          process.stdout.write('Result: skipped (missing base/head worktrees or config.commands.benchmark).\n');
        } else {
          const artifact = await runBenchmarkComparison(
            baseWorktree.path,
            headWorktree.path,
            config.commands.benchmark,
            plan.budget.timeoutMs
          );
          context.artifacts.push(artifact);
          process.stdout.write('Result: benchmark comparison complete.\n');
          process.stdout.write(`${formatArtifact(artifact)}\n`);
        }
      } else if (action.kind === 'llm_review') {
        process.stdout.write(`Result: propose comments using verifier model "${model.name}".\n`);
        candidateComments = await model.proposeComments({ context, plan });
        process.stdout.write(`Candidate comments: ${candidateComments.length}\n`);
        for (const c of candidateComments) process.stdout.write(`${formatComment(c)}\n`);
      } else if (action.kind === 'llm_filter') {
        process.stdout.write('Result: handled by harness verifier step (evidence gating + ranking).\n');
      } else {
        process.stdout.write('Result: skipped (not implemented in demo executor).\n');
      }

      const elapsed = Date.now() - started;
      const added = context.artifacts.length - artifactsBefore;
      process.stdout.write(`Action summary: artifactsAdded=${added}, elapsedMs=${elapsed}\n`);
      process.stdout.write(`${SEP}\n`);
    }

    return { candidateComments };
  } finally {
    section(`${label} — Executor cleanup`);
    await headWorktree?.cleanup();
    await baseWorktree?.cleanup();
    process.stdout.write('Cleaned up demo worktrees.\n');
  }
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
    const demoConfig: VetraConfig = {
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
    };
    await writeJson(join(root, 'vetra.config.json'), demoConfig);

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

    section('DEMO: Repository + PR metadata');
    process.stdout.write(`repoRoot: ${root}\nbaseRef: ${base}\nheadRef: ${head}\n`);

    const meta = {
      id: 'demo',
      title: 'DEMO-123: Harden auth normalization',
      description: 'Implements DEMO-123; tests still pass, but deeper checks should catch regressions.',
      source: 'local' as const
    };

    section('DEMO: PR object (PullRequestContext)');
    const baseContext = await buildPullRequestContext({ repoRoot: root, baseRef: base, headRef: head, meta, config: demoConfig });
    json('meta', baseContext.meta);
    json('riskFeatures', baseContext.riskFeatures);
    json('knowledge', baseContext.knowledge);
    json('diffSummary', summarizeDiff(baseContext));
    process.stdout.write(`\nUnified diff:\n${renderUnifiedDiff(baseContext)}\n`);
    process.stdout.write(`\nInitial artifacts (knowledge):\n${baseContext.artifacts.map(formatArtifact).join('\n')}\n`);
    json('pullRequestContext', baseContext);

    const runOne = async (label: string, overrideBudget?: BudgetMode) => {
      section(`${label} — STEP 1: Clone PR object`);
      const context = cloneJson(baseContext);
      process.stdout.write(`Starting artifacts: ${JSON.stringify(summarizeArtifacts(context.artifacts))}\n`);

      section(`${label} — STEP 2: Planner (risk -> budget -> actions)`);
      const plan = planReview(context, demoConfig, overrideBudget);
      json('riskScore', plan.risk);
      json('budget', plan.budget);
      process.stdout.write(`Planned actions (${plan.actions.length}):\n${plan.actions.map(formatAction).join('\n')}\n`);
      json('plan', plan);

      const execRes = await executeWithTrace(context, plan, demoConfig, label);

      section(`${label} — STEP 4: Harness verifier (evidence gating + ranking)`);
      const finalComments = verifyAndRankComments(context, plan, execRes.candidateComments, demoConfig);
      process.stdout.write(`Candidate comments: ${execRes.candidateComments.length}\n`);
      process.stdout.write(`Final comments: ${finalComments.length}\n`);
      if (execRes.candidateComments.length > 0) {
        process.stdout.write(`\nCandidates:\n${execRes.candidateComments.map(formatComment).join('\n')}\n`);
      }
      if (finalComments.length > 0) {
        process.stdout.write(`\nFinal:\n${finalComments.map(formatComment).join('\n')}\n`);
      }

      section(`${label} — STEP 5: Rendered review (Markdown)`);
      const markdown = formatReviewMarkdown(plan, context.knowledge, context.artifacts, finalComments);
      process.stdout.write(`${markdown}\n`);
    };

    await runOne('QUICK REVIEW (budget override = quick)', 'quick');
    await runOne('AUTO REVIEW (risk-budgeted)', undefined);
  } finally {
    const keep = process.env.VETRA_DEMO_KEEP === '1';
    if (keep) {
      section('DEMO: Keeping temp repo');
      process.stdout.write(`VETRA_DEMO_KEEP=1; keeping demo repo at: ${root}\n`);
    } else {
      await rm(root, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err));
  process.exit(1);
});
