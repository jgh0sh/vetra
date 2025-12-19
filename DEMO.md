# Demo: Understanding `npm run demo`

This demo runs an end-to-end **Planner → Executor → Verifier** pass on a tiny synthetic PR inside a temporary git repo. It is meant to make the pipeline observable and debuggable.

## What the demo does

1. **Creates a temporary git repo** with a base commit and a PR (head) commit.
2. **Builds a PR context object** (metadata, parsed diff, risk features, repo knowledge snippets).
3. **Plans** a review under a risk-based budget (which actions to run, and why).
4. **Executes** checks to produce evidence artifacts (CI, metamorphic check, diff-scoped mutation testing, micro-benchmark).
5. **Proposes candidate comments** (currently via a heuristic “model” stub that turns evidence into comments).
6. **Verifies + ranks** comments with an evidence-gated policy and renders a Markdown review.

## How to read the output

- Output is divided into **sections** separated by a line of `================================================================================`.
- The most important objects you’ll see:
  - **PullRequestContext**: the PR object Vetra operates on (metadata, diff, riskFeatures, knowledge, artifacts).
  - **ReviewPlan**: budget + ordered actions the Executor will run.
  - **Evidence artifacts**: machine-generated witnesses (each has an `artifactId` that comments must cite).
  - **Comments**: severity/category/confidence + locations + evidence references.
- This demo prints **two passes**:
  - **QUICK REVIEW**: minimal actions.
  - **AUTO REVIEW (risk-budgeted)**: full planned checks.
- **Paths and commit SHAs change every run** because the repo is created under a temporary directory.

## Captured output

<details>
<summary>Click to expand the raw `npm run demo` output</summary>

```text
timestamp=2025-12-19T01:39:57.109Z
cwd=/Users/jayghosh/Documents/projects/vetra
node=v23.10.0
platform=darwin
arch=arm64

================================================================================
PHASE: build
================================================================================

> vetra@0.1.0 build
> tsc -p tsconfig.json


================================================================================
PHASE: demo
================================================================================

================================================================================
DEMO: Repository + PR metadata
================================================================================
repoRoot: /var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS
baseRef: 3cf470bfa787a73f2cc487e18c6cb6a23cc45231
headRef: f355afdb103d93b179c9c688f228ceb08ef51a3d

================================================================================
DEMO: PR object (PullRequestContext)
================================================================================
meta:
{
  "id": "demo",
  "title": "DEMO-123: Harden auth normalization",
  "description": "Implements DEMO-123; tests still pass, but deeper checks should catch regressions.",
  "source": "local"
}
riskFeatures:
{
  "filesChanged": 4,
  "linesAdded": 14,
  "linesDeleted": 5,
  "touchesSensitivePaths": true,
  "touchesBuildOrDeps": true,
  "touchesAuthnOrCrypto": true
}
knowledge:
{
  "issues": [
    {
      "key": "DEMO-123",
      "title": "Harden auth normalization",
      "acceptanceCriteria": [
        "Normalization should be idempotent: f(f(x)) == f(x).",
        "In strict mode, only issuer \"internal\" is trusted."
      ],
      "url": "https://example.com/issues/DEMO-123"
    }
  ],
  "architectureNotes": [
    {
      "title": "Architecture Notes",
      "excerpt": "# Architecture Notes\n\n- `src/auth/*` is security-sensitive.\n- Avoid behavior changes without explicit tests.",
      "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/architecture.md"
    }
  ],
  "northStar": [
    {
      "title": "North Star",
      "excerpt": "# North Star\n\n- Prefer evidence-backed feedback (tests, traces, benchmarks).\n- Minimize noisy comments; be precision-first.\n- Protect auth and security-sensitive surfaces.",
      "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/north-star.md"
    }
  ],
  "precedent": []
}
diffSummary:
{
  "filesChanged": 4,
  "linesAdded": 14,
  "linesDeleted": 5,
  "files": [
    {
      "file": "bench.js",
      "additions": 1,
      "deletions": 1,
      "hunks": 1,
      "language": "javascript"
    },
    {
      "file": "package.json",
      "additions": 1,
      "deletions": 0,
      "hunks": 1,
      "language": "json"
    },
    {
      "file": "src/auth/normalize.js",
      "additions": 10,
      "deletions": 2,
      "hunks": 1,
      "language": "javascript"
    },
    {
      "file": "test/normalize.test.js",
      "additions": 2,
      "deletions": 2,
      "hunks": 1,
      "language": "javascript"
    }
  ]
}

Unified diff:
File: bench.js (+1/-1)
@@ -1,6 +1,6 @@
 // Prints a numeric value; Vetra parses the first number from stdout/stderr.
 const started = Date.now();
 let x = 0;
-for (let i = 0; i < 2e6; i++) x += i;
+for (let i = 0; i < 2e7; i++) x += i;
 const ms = Date.now() - started;
 console.log(ms);

File: package.json (+1/-0)
@@ -1,6 +1,7 @@
 {
   "name": "vetra-demo-repo",
   "private": true,
+  "description": "Demo repo for Vetra (auth-sensitive change).",
   "scripts": {
     "test": "node --test"
   }

File: src/auth/normalize.js (+10/-2)
@@ -1,5 +1,13 @@
 function normalizeWhitespace(s) {
-  return String(s).replace(/\s+/g, ' ').trim();
+  const out = String(s).replace(/\s+/g, ' ').trim();
+  return out + (String(s).endsWith(' ') ? '' : ' ');
 }
 
-module.exports = { normalizeWhitespace };
+function isTrustedIssuer(issuer, mode) {
+  if (mode === 'strict') {
+    return issuer === 'internal';
+  }
+  return true;
+}
+
+module.exports = { normalizeWhitespace, isTrustedIssuer };

File: test/normalize.test.js (+2/-2)
@@ -3,9 +3,9 @@ const assert = require('node:assert/strict');
 const { normalizeWhitespace } = require('../src/auth/normalize');
 
 test('collapses inner whitespace', () => {
-  assert.equal(normalizeWhitespace('a   b'), 'a b');
+  assert.equal(normalizeWhitespace('a   b').trim(), 'a b');
 });
 
 test('trims ends', () => {
-  assert.equal(normalizeWhitespace('  a b  '), 'a b');
+  assert.equal(normalizeWhitespace('  a b  ').trim(), 'a b');
 });

Initial artifacts (knowledge):
- [knowledge] artifact_know_issue_3520dcd4-3b67-4def-bd58-729f6b4a3e3f: Issue DEMO-123 — Harden auth normalization — Acceptance criteria: Normalization should be idempotent: f(f(x)) == f(x). | In strict mode, only issuer "internal" is trusted.
- [knowledge] artifact_know_arch_3961c972-fcdd-4b73-af1a-5a7588be8030: Architecture: Architecture Notes — # Architecture Notes

- `src/auth/*` is security-sensitive.
- Avoid behavior changes without explicit tests.
- [knowledge] artifact_know_ns_8c85961a-8cfc-4646-8b93-a732dc582fc7: North Star: North Star — # North Star

- Prefer evidence-backed feedback (tests, traces, benchmarks).
- Minimize noisy comments; be precision-first.
- Protect auth and security-sensitive surfaces.
pullRequestContext:
{
  "meta": {
    "id": "demo",
    "title": "DEMO-123: Harden auth normalization",
    "description": "Implements DEMO-123; tests still pass, but deeper checks should catch regressions.",
    "source": "local"
  },
  "repoRoot": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS",
  "baseRef": "3cf470bfa787a73f2cc487e18c6cb6a23cc45231",
  "headRef": "f355afdb103d93b179c9c688f228ceb08ef51a3d",
  "diff": {
    "files": [
      {
        "oldPath": "bench.js",
        "newPath": "bench.js",
        "hunks": [
          {
            "header": "@@ -1,6 +1,6 @@",
            "oldStart": 1,
            "oldLines": 6,
            "newStart": 1,
            "newLines": 6,
            "lines": [
              {
                "type": "context",
                "content": "// Prints a numeric value; Vetra parses the first number from stdout/stderr.",
                "oldLine": 1,
                "newLine": 1
              },
              {
                "type": "context",
                "content": "const started = Date.now();",
                "oldLine": 2,
                "newLine": 2
              },
              {
                "type": "context",
                "content": "let x = 0;",
                "oldLine": 3,
                "newLine": 3
              },
              {
                "type": "del",
                "content": "for (let i = 0; i < 2e6; i++) x += i;",
                "oldLine": 4
              },
              {
                "type": "add",
                "content": "for (let i = 0; i < 2e7; i++) x += i;",
                "newLine": 4
              },
              {
                "type": "context",
                "content": "const ms = Date.now() - started;",
                "oldLine": 5,
                "newLine": 5
              },
              {
                "type": "context",
                "content": "console.log(ms);",
                "oldLine": 6,
                "newLine": 6
              }
            ]
          }
        ],
        "additions": 1,
        "deletions": 1,
        "isNew": false,
        "isDeleted": false,
        "language": "javascript"
      },
      {
        "oldPath": "package.json",
        "newPath": "package.json",
        "hunks": [
          {
            "header": "@@ -1,6 +1,7 @@",
            "oldStart": 1,
            "oldLines": 6,
            "newStart": 1,
            "newLines": 7,
            "lines": [
              {
                "type": "context",
                "content": "{",
                "oldLine": 1,
                "newLine": 1
              },
              {
                "type": "context",
                "content": "  \"name\": \"vetra-demo-repo\",",
                "oldLine": 2,
                "newLine": 2
              },
              {
                "type": "context",
                "content": "  \"private\": true,",
                "oldLine": 3,
                "newLine": 3
              },
              {
                "type": "add",
                "content": "  \"description\": \"Demo repo for Vetra (auth-sensitive change).\",",
                "newLine": 4
              },
              {
                "type": "context",
                "content": "  \"scripts\": {",
                "oldLine": 4,
                "newLine": 5
              },
              {
                "type": "context",
                "content": "    \"test\": \"node --test\"",
                "oldLine": 5,
                "newLine": 6
              },
              {
                "type": "context",
                "content": "  }",
                "oldLine": 6,
                "newLine": 7
              }
            ]
          }
        ],
        "additions": 1,
        "deletions": 0,
        "isNew": false,
        "isDeleted": false,
        "language": "json"
      },
      {
        "oldPath": "src/auth/normalize.js",
        "newPath": "src/auth/normalize.js",
        "hunks": [
          {
            "header": "@@ -1,5 +1,13 @@",
            "oldStart": 1,
            "oldLines": 5,
            "newStart": 1,
            "newLines": 13,
            "lines": [
              {
                "type": "context",
                "content": "function normalizeWhitespace(s) {",
                "oldLine": 1,
                "newLine": 1
              },
              {
                "type": "del",
                "content": "  return String(s).replace(/\\s+/g, ' ').trim();",
                "oldLine": 2
              },
              {
                "type": "add",
                "content": "  const out = String(s).replace(/\\s+/g, ' ').trim();",
                "newLine": 2
              },
              {
                "type": "add",
                "content": "  return out + (String(s).endsWith(' ') ? '' : ' ');",
                "newLine": 3
              },
              {
                "type": "context",
                "content": "}",
                "oldLine": 3,
                "newLine": 4
              },
              {
                "type": "context",
                "content": "",
                "oldLine": 4,
                "newLine": 5
              },
              {
                "type": "del",
                "content": "module.exports = { normalizeWhitespace };",
                "oldLine": 5
              },
              {
                "type": "add",
                "content": "function isTrustedIssuer(issuer, mode) {",
                "newLine": 6
              },
              {
                "type": "add",
                "content": "  if (mode === 'strict') {",
                "newLine": 7
              },
              {
                "type": "add",
                "content": "    return issuer === 'internal';",
                "newLine": 8
              },
              {
                "type": "add",
                "content": "  }",
                "newLine": 9
              },
              {
                "type": "add",
                "content": "  return true;",
                "newLine": 10
              },
              {
                "type": "add",
                "content": "}",
                "newLine": 11
              },
              {
                "type": "add",
                "content": "",
                "newLine": 12
              },
              {
                "type": "add",
                "content": "module.exports = { normalizeWhitespace, isTrustedIssuer };",
                "newLine": 13
              }
            ]
          }
        ],
        "additions": 10,
        "deletions": 2,
        "isNew": false,
        "isDeleted": false,
        "language": "javascript"
      },
      {
        "oldPath": "test/normalize.test.js",
        "newPath": "test/normalize.test.js",
        "hunks": [
          {
            "header": "@@ -3,9 +3,9 @@ const assert = require('node:assert/strict');",
            "oldStart": 3,
            "oldLines": 9,
            "newStart": 3,
            "newLines": 9,
            "lines": [
              {
                "type": "context",
                "content": "const { normalizeWhitespace } = require('../src/auth/normalize');",
                "oldLine": 3,
                "newLine": 3
              },
              {
                "type": "context",
                "content": "",
                "oldLine": 4,
                "newLine": 4
              },
              {
                "type": "context",
                "content": "test('collapses inner whitespace', () => {",
                "oldLine": 5,
                "newLine": 5
              },
              {
                "type": "del",
                "content": "  assert.equal(normalizeWhitespace('a   b'), 'a b');",
                "oldLine": 6
              },
              {
                "type": "add",
                "content": "  assert.equal(normalizeWhitespace('a   b').trim(), 'a b');",
                "newLine": 6
              },
              {
                "type": "context",
                "content": "});",
                "oldLine": 7,
                "newLine": 7
              },
              {
                "type": "context",
                "content": "",
                "oldLine": 8,
                "newLine": 8
              },
              {
                "type": "context",
                "content": "test('trims ends', () => {",
                "oldLine": 9,
                "newLine": 9
              },
              {
                "type": "del",
                "content": "  assert.equal(normalizeWhitespace('  a b  '), 'a b');",
                "oldLine": 10
              },
              {
                "type": "add",
                "content": "  assert.equal(normalizeWhitespace('  a b  ').trim(), 'a b');",
                "newLine": 10
              },
              {
                "type": "context",
                "content": "});",
                "oldLine": 11,
                "newLine": 11
              }
            ]
          }
        ],
        "additions": 2,
        "deletions": 2,
        "isNew": false,
        "isDeleted": false,
        "language": "javascript"
      }
    ]
  },
  "riskFeatures": {
    "filesChanged": 4,
    "linesAdded": 14,
    "linesDeleted": 5,
    "touchesSensitivePaths": true,
    "touchesBuildOrDeps": true,
    "touchesAuthnOrCrypto": true
  },
  "knowledge": {
    "issues": [
      {
        "key": "DEMO-123",
        "title": "Harden auth normalization",
        "acceptanceCriteria": [
          "Normalization should be idempotent: f(f(x)) == f(x).",
          "In strict mode, only issuer \"internal\" is trusted."
        ],
        "url": "https://example.com/issues/DEMO-123"
      }
    ],
    "architectureNotes": [
      {
        "title": "Architecture Notes",
        "excerpt": "# Architecture Notes\n\n- `src/auth/*` is security-sensitive.\n- Avoid behavior changes without explicit tests.",
        "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/architecture.md"
      }
    ],
    "northStar": [
      {
        "title": "North Star",
        "excerpt": "# North Star\n\n- Prefer evidence-backed feedback (tests, traces, benchmarks).\n- Minimize noisy comments; be precision-first.\n- Protect auth and security-sensitive surfaces.",
        "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/north-star.md"
      }
    ],
    "precedent": []
  },
  "artifacts": [
    {
      "id": "artifact_know_issue_3520dcd4-3b67-4def-bd58-729f6b4a3e3f",
      "type": "knowledge",
      "title": "Issue DEMO-123 — Harden auth normalization",
      "summary": "Acceptance criteria: Normalization should be idempotent: f(f(x)) == f(x). | In strict mode, only issuer \"internal\" is trusted.",
      "createdAt": "2025-12-19T01:39:58.215Z",
      "raw": {
        "key": "DEMO-123",
        "title": "Harden auth normalization",
        "acceptanceCriteria": [
          "Normalization should be idempotent: f(f(x)) == f(x).",
          "In strict mode, only issuer \"internal\" is trusted."
        ],
        "url": "https://example.com/issues/DEMO-123"
      }
    },
    {
      "id": "artifact_know_arch_3961c972-fcdd-4b73-af1a-5a7588be8030",
      "type": "knowledge",
      "title": "Architecture: Architecture Notes",
      "summary": "# Architecture Notes\n\n- `src/auth/*` is security-sensitive.\n- Avoid behavior changes without explicit tests.",
      "createdAt": "2025-12-19T01:39:58.215Z",
      "raw": {
        "title": "Architecture Notes",
        "excerpt": "# Architecture Notes\n\n- `src/auth/*` is security-sensitive.\n- Avoid behavior changes without explicit tests.",
        "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/architecture.md"
      }
    },
    {
      "id": "artifact_know_ns_8c85961a-8cfc-4646-8b93-a732dc582fc7",
      "type": "knowledge",
      "title": "North Star: North Star",
      "summary": "# North Star\n\n- Prefer evidence-backed feedback (tests, traces, benchmarks).\n- Minimize noisy comments; be precision-first.\n- Protect auth and security-sensitive surfaces.",
      "createdAt": "2025-12-19T01:39:58.215Z",
      "raw": {
        "title": "North Star",
        "excerpt": "# North Star\n\n- Prefer evidence-backed feedback (tests, traces, benchmarks).\n- Minimize noisy comments; be precision-first.\n- Protect auth and security-sensitive surfaces.",
        "source": "/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/north-star.md"
      }
    }
  ]
}

================================================================================
QUICK REVIEW (budget override = quick) — STEP 1: Clone PR object
================================================================================
Starting artifacts: {"total":3,"byType":{"knowledge":3}}

================================================================================
QUICK REVIEW (budget override = quick) — STEP 2: Planner (risk -> budget -> actions)
================================================================================
riskScore:
{
  "total": 81,
  "breakdown": {
    "changeSize": 23,
    "files": 8,
    "sensitivePaths": 20,
    "buildOrDeps": 15,
    "authnOrCrypto": 15
  }
}
budget:
{
  "mode": "quick",
  "maxModelCalls": 1,
  "maxDynamicChecks": 1,
  "maxComments": 8,
  "timeoutMs": 30000
}
Planned actions (5):
- [gather_context] action_199283ea-669f-4612-a5e2-a2dd5b898fdb (cost=1): Build PR context model (metadata + diff + risk features).
- [retrieve_knowledge] action_ffe8d4f6-63e2-4e16-8b18-80e6552ee39f (cost=1): Retrieve linked issues and repo knowledge (North Star, architecture notes).
- [run_ci] action_e957a06c-84d3-4bfb-858d-3e3e6f6112f0 (cost=2): Run tests/CI command: node --test
- [llm_review] action_3ae215af-2f3b-465e-83c2-3d383108d180 (cost=2): Invoke verifier model to propose comments (evidence-aware).
- [llm_filter] action_88089656-ee93-440d-839a-19140277c47e (cost=1): Verifier pass: evidence-gated filtering + ranking.
plan:
{
  "risk": {
    "total": 81,
    "breakdown": {
      "changeSize": 23,
      "files": 8,
      "sensitivePaths": 20,
      "buildOrDeps": 15,
      "authnOrCrypto": 15
    }
  },
  "budget": {
    "mode": "quick",
    "maxModelCalls": 1,
    "maxDynamicChecks": 1,
    "maxComments": 8,
    "timeoutMs": 30000
  },
  "actions": [
    {
      "id": "action_199283ea-669f-4612-a5e2-a2dd5b898fdb",
      "kind": "gather_context",
      "description": "Build PR context model (metadata + diff + risk features).",
      "estimatedCost": 1
    },
    {
      "id": "action_ffe8d4f6-63e2-4e16-8b18-80e6552ee39f",
      "kind": "retrieve_knowledge",
      "description": "Retrieve linked issues and repo knowledge (North Star, architecture notes).",
      "estimatedCost": 1
    },
    {
      "id": "action_e957a06c-84d3-4bfb-858d-3e3e6f6112f0",
      "kind": "run_ci",
      "description": "Run tests/CI command: node --test",
      "estimatedCost": 2,
      "params": {
        "command": "node --test"
      }
    },
    {
      "id": "action_3ae215af-2f3b-465e-83c2-3d383108d180",
      "kind": "llm_review",
      "description": "Invoke verifier model to propose comments (evidence-aware).",
      "estimatedCost": 2
    },
    {
      "id": "action_88089656-ee93-440d-839a-19140277c47e",
      "kind": "llm_filter",
      "description": "Verifier pass: evidence-gated filtering + ranking.",
      "estimatedCost": 1
    }
  ]
}

================================================================================
QUICK REVIEW (budget override = quick) — STEP 3: Executor (run checks + collect evidence + propose comments)
================================================================================
Worktrees: needsBase=false, needsHead=true
Created head worktree: /var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-head-dWXoGl @ f355afdb103d93b179c9c688f228ceb08ef51a3d

================================================================================
QUICK REVIEW (budget override = quick) — EXEC ACTION: gather_context
================================================================================
- [gather_context] action_199283ea-669f-4612-a5e2-a2dd5b898fdb (cost=1): Build PR context model (metadata + diff + risk features).
Result: already done (context is built before planning).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
QUICK REVIEW (budget override = quick) — EXEC ACTION: retrieve_knowledge
================================================================================
- [retrieve_knowledge] action_ffe8d4f6-63e2-4e16-8b18-80e6552ee39f (cost=1): Retrieve linked issues and repo knowledge (North Star, architecture notes).
Result: already done (knowledge is loaded during context build).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
QUICK REVIEW (budget override = quick) — EXEC ACTION: run_ci
================================================================================
- [run_ci] action_e957a06c-84d3-4bfb-858d-3e3e6f6112f0 (cost=2): Run tests/CI command: node --test
Result: PASS
- [ci] artifact_ci_5a1c5129-38e3-40e3-b233-042d1146eadc: CI/tests passed — Command succeeded: node --test
Action summary: artifactsAdded=1, elapsedMs=83
================================================================================

================================================================================
QUICK REVIEW (budget override = quick) — EXEC ACTION: llm_review
================================================================================
- [llm_review] action_3ae215af-2f3b-465e-83c2-3d383108d180 (cost=2): Invoke verifier model to propose comments (evidence-aware).
Result: propose comments using verifier model "heuristic".
Candidate comments: 0
Action summary: artifactsAdded=0, elapsedMs=1
================================================================================

================================================================================
QUICK REVIEW (budget override = quick) — EXEC ACTION: llm_filter
================================================================================
- [llm_filter] action_88089656-ee93-440d-839a-19140277c47e (cost=1): Verifier pass: evidence-gated filtering + ranking.
Result: handled by harness verifier step (evidence gating + ranking).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
QUICK REVIEW (budget override = quick) — Executor cleanup
================================================================================
Cleaned up demo worktrees.

================================================================================
QUICK REVIEW (budget override = quick) — STEP 4: Harness verifier (evidence gating + ranking)
================================================================================
Candidate comments: 0
Final comments: 0

================================================================================
QUICK REVIEW (budget override = quick) — STEP 5: Rendered review (Markdown)
================================================================================
# Vetra Review

Risk: 81/100 (changeSize=23, files=8, sensitivePaths=20, buildOrDeps=15, authnOrCrypto=15)
Budget: quick (modelCalls<=1, dynamicChecks<=1, comments<=8, timeoutMs=30000)

## Knowledge
Issues:
- DEMO-123 — Harden auth normalization
  - AC: Normalization should be idempotent: f(f(x)) == f(x).
  - AC: In strict mode, only issuer "internal" is trusted.

Architecture:
- Architecture Notes (/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/architecture.md)

North Star:
- North Star (/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/north-star.md)

## Plan
- [gather_context] Build PR context model (metadata + diff + risk features).
- [retrieve_knowledge] Retrieve linked issues and repo knowledge (North Star, architecture notes).
- [run_ci] Run tests/CI command: node --test
- [llm_review] Invoke verifier model to propose comments (evidence-aware).
- [llm_filter] Verifier pass: evidence-gated filtering + ranking.

## Evidence
- [knowledge] artifact_know_issue_3520dcd4-3b67-4def-bd58-729f6b4a3e3f: Issue DEMO-123 — Harden auth normalization — Acceptance criteria: Normalization should be idempotent: f(f(x)) == f(x). | In strict mode, only issuer "internal" is trusted.
- [knowledge] artifact_know_arch_3961c972-fcdd-4b73-af1a-5a7588be8030: Architecture: Architecture Notes — # Architecture Notes

- `src/auth/*` is security-sensitive.
- Avoid behavior changes without explicit tests.
- [knowledge] artifact_know_ns_8c85961a-8cfc-4646-8b93-a732dc582fc7: North Star: North Star — # North Star

- Prefer evidence-backed feedback (tests, traces, benchmarks).
- Minimize noisy comments; be precision-first.
- Protect auth and security-sensitive surfaces.
- [ci] artifact_ci_5a1c5129-38e3-40e3-b233-042d1146eadc: CI/tests passed — Command succeeded: node --test

## Comments
No comments (precision-first).


================================================================================
AUTO REVIEW (risk-budgeted) — STEP 1: Clone PR object
================================================================================
Starting artifacts: {"total":3,"byType":{"knowledge":3}}

================================================================================
AUTO REVIEW (risk-budgeted) — STEP 2: Planner (risk -> budget -> actions)
================================================================================
riskScore:
{
  "total": 81,
  "breakdown": {
    "changeSize": 23,
    "files": 8,
    "sensitivePaths": 20,
    "buildOrDeps": 15,
    "authnOrCrypto": 15
  }
}
budget:
{
  "mode": "deep",
  "maxModelCalls": 3,
  "maxDynamicChecks": 3,
  "maxComments": 10,
  "timeoutMs": 120000
}
Planned actions (8):
- [gather_context] action_938103c5-b70b-4eaf-aa49-50ac461d683d (cost=1): Build PR context model (metadata + diff + risk features).
- [retrieve_knowledge] action_becc4015-042c-437e-a458-9e593ffe9f1a (cost=1): Retrieve linked issues and repo knowledge (North Star, architecture notes).
- [run_ci] action_7341ce81-c1bf-4177-b2ca-dbeeafc0ddfd (cost=3): Run tests/CI command: node --test
- [metamorphic] action_02c3a094-8efd-4a5a-ad8a-92abdd895d5d (cost=3): Run metamorphic checks (config-driven specs).
- [mutation] action_5ab9ddde-96e1-4b43-8dc7-5aabe3d96fc5 (cost=3): Run diff-scoped mutation testing (limited budget).
- [benchmark] action_abf915ee-f4b4-4b7d-ada3-abd7dd3f4a6a (cost=3): Run performance micro-benchmark: node bench.js
- [llm_review] action_dac00078-d921-40ed-bff5-88ddf285904f (cost=2): Invoke verifier model to propose comments (evidence-aware).
- [llm_filter] action_ab917d66-3091-459a-aa63-8e09488c8460 (cost=1): Verifier pass: evidence-gated filtering + ranking.
plan:
{
  "risk": {
    "total": 81,
    "breakdown": {
      "changeSize": 23,
      "files": 8,
      "sensitivePaths": 20,
      "buildOrDeps": 15,
      "authnOrCrypto": 15
    }
  },
  "budget": {
    "mode": "deep",
    "maxModelCalls": 3,
    "maxDynamicChecks": 3,
    "maxComments": 10,
    "timeoutMs": 120000
  },
  "actions": [
    {
      "id": "action_938103c5-b70b-4eaf-aa49-50ac461d683d",
      "kind": "gather_context",
      "description": "Build PR context model (metadata + diff + risk features).",
      "estimatedCost": 1
    },
    {
      "id": "action_becc4015-042c-437e-a458-9e593ffe9f1a",
      "kind": "retrieve_knowledge",
      "description": "Retrieve linked issues and repo knowledge (North Star, architecture notes).",
      "estimatedCost": 1
    },
    {
      "id": "action_7341ce81-c1bf-4177-b2ca-dbeeafc0ddfd",
      "kind": "run_ci",
      "description": "Run tests/CI command: node --test",
      "estimatedCost": 3,
      "params": {
        "command": "node --test"
      }
    },
    {
      "id": "action_02c3a094-8efd-4a5a-ad8a-92abdd895d5d",
      "kind": "metamorphic",
      "description": "Run metamorphic checks (config-driven specs).",
      "estimatedCost": 3
    },
    {
      "id": "action_5ab9ddde-96e1-4b43-8dc7-5aabe3d96fc5",
      "kind": "mutation",
      "description": "Run diff-scoped mutation testing (limited budget).",
      "estimatedCost": 3
    },
    {
      "id": "action_abf915ee-f4b4-4b7d-ada3-abd7dd3f4a6a",
      "kind": "benchmark",
      "description": "Run performance micro-benchmark: node bench.js",
      "estimatedCost": 3,
      "params": {
        "command": "node bench.js"
      }
    },
    {
      "id": "action_dac00078-d921-40ed-bff5-88ddf285904f",
      "kind": "llm_review",
      "description": "Invoke verifier model to propose comments (evidence-aware).",
      "estimatedCost": 2
    },
    {
      "id": "action_ab917d66-3091-459a-aa63-8e09488c8460",
      "kind": "llm_filter",
      "description": "Verifier pass: evidence-gated filtering + ranking.",
      "estimatedCost": 1
    }
  ]
}

================================================================================
AUTO REVIEW (risk-budgeted) — STEP 3: Executor (run checks + collect evidence + propose comments)
================================================================================
Worktrees: needsBase=true, needsHead=true
Created base worktree: /var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-base-LhDkE1 @ 3cf470bfa787a73f2cc487e18c6cb6a23cc45231
Created head worktree: /var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-head-0MQ9cF @ f355afdb103d93b179c9c688f228ceb08ef51a3d

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: gather_context
================================================================================
- [gather_context] action_938103c5-b70b-4eaf-aa49-50ac461d683d (cost=1): Build PR context model (metadata + diff + risk features).
Result: already done (context is built before planning).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: retrieve_knowledge
================================================================================
- [retrieve_knowledge] action_becc4015-042c-437e-a458-9e593ffe9f1a (cost=1): Retrieve linked issues and repo knowledge (North Star, architecture notes).
Result: already done (knowledge is loaded during context build).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: run_ci
================================================================================
- [run_ci] action_7341ce81-c1bf-4177-b2ca-dbeeafc0ddfd (cost=3): Run tests/CI command: node --test
Result: PASS
- [ci] artifact_ci_1eb665b7-8a01-4f8b-b5e7-5f43824d7a8b: CI/tests passed — Command succeeded: node --test
Action summary: artifactsAdded=1, elapsedMs=81
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: metamorphic
================================================================================
- [metamorphic] action_02c3a094-8efd-4a5a-ad8a-92abdd895d5d (cost=3): Run metamorphic checks (config-driven specs).
Result: produced 1 artifact(s), regressions=1
- [metamorphic] artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c (src/auth/normalize.js): Metamorphic regression: idempotent — src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok).
Action summary: artifactsAdded=1, elapsedMs=2
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: mutation
================================================================================
- [mutation] action_5ab9ddde-96e1-4b43-8dc7-5aabe3d96fc5 (cost=3): Run diff-scoped mutation testing (limited budget).
Result: produced 4 artifact(s), survivingMutants=3
- [mutation] artifact_mut_summary_415529d5-3ba8-411b-8539-feeccbf6922e: Diff-scoped mutation testing summary — Attempted 3 mutants; survived 3.
- [mutation] artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b (src/auth/normalize.js:7): Surviving mutant (diff-scoped) — src/auth/normalize.js:7 flip_equality survived; consider adding a test/assertion.
- [mutation] artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8 (src/auth/normalize.js:8): Surviving mutant (diff-scoped) — src/auth/normalize.js:8 flip_equality survived; consider adding a test/assertion.
- [mutation] artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d (src/auth/normalize.js:10): Surviving mutant (diff-scoped) — src/auth/normalize.js:10 flip_bool survived; consider adding a test/assertion.
Action summary: artifactsAdded=4, elapsedMs=280
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: benchmark
================================================================================
- [benchmark] action_abf915ee-f4b4-4b7d-ada3-abd7dd3f4a6a (cost=3): Run performance micro-benchmark: node bench.js
Result: benchmark comparison complete.
- [benchmark] artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad: Micro-benchmark comparison — base=4, head=22, delta=18 (regression)
Action summary: artifactsAdded=1, elapsedMs=56
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: llm_review
================================================================================
- [llm_review] action_dac00078-d921-40ed-bff5-88ddf285904f (cost=2): Invoke verifier model to propose comments (evidence-aware).
Result: propose comments using verifier model "heuristic".
Candidate comments: 3
- [comment_01883d5b-989e-4ee8-a6e4-ee7f1aee335f] (high/correctness/high) src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok). locations=[src/auth/normalize.js] evidence=[artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c]
- [comment_3d2262d2-203c-4940-ae92-66bbb57a65ef] (medium/tests/medium) Some diff-scoped mutants survived (3). This often indicates missing test coverage around changed logic. locations=[src/auth/normalize.js:7, src/auth/normalize.js:8, src/auth/normalize.js:10] evidence=[artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b, artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8, artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d]
- [comment_74d3d1fe-cc7b-4e30-8a83-ba2808919fad] (medium/performance/medium) Micro-benchmark indicates a performance regression. Consider optimizing hot paths or validating with representative load. evidence=[artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad]
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — EXEC ACTION: llm_filter
================================================================================
- [llm_filter] action_ab917d66-3091-459a-aa63-8e09488c8460 (cost=1): Verifier pass: evidence-gated filtering + ranking.
Result: handled by harness verifier step (evidence gating + ranking).
Action summary: artifactsAdded=0, elapsedMs=0
================================================================================

================================================================================
AUTO REVIEW (risk-budgeted) — Executor cleanup
================================================================================
Cleaned up demo worktrees.

================================================================================
AUTO REVIEW (risk-budgeted) — STEP 4: Harness verifier (evidence gating + ranking)
================================================================================
Candidate comments: 3
Final comments: 3

Candidates:
- [comment_01883d5b-989e-4ee8-a6e4-ee7f1aee335f] (high/correctness/high) src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok). locations=[src/auth/normalize.js] evidence=[artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c]
- [comment_3d2262d2-203c-4940-ae92-66bbb57a65ef] (medium/tests/medium) Some diff-scoped mutants survived (3). This often indicates missing test coverage around changed logic. locations=[src/auth/normalize.js:7, src/auth/normalize.js:8, src/auth/normalize.js:10] evidence=[artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b, artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8, artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d]
- [comment_74d3d1fe-cc7b-4e30-8a83-ba2808919fad] (medium/performance/medium) Micro-benchmark indicates a performance regression. Consider optimizing hot paths or validating with representative load. evidence=[artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad]

Final:
- [comment_01883d5b-989e-4ee8-a6e4-ee7f1aee335f] (high/correctness/high) src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok). locations=[src/auth/normalize.js] evidence=[artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c]
- [comment_3d2262d2-203c-4940-ae92-66bbb57a65ef] (medium/tests/medium) Some diff-scoped mutants survived (3). This often indicates missing test coverage around changed logic. locations=[src/auth/normalize.js:7, src/auth/normalize.js:8, src/auth/normalize.js:10] evidence=[artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b, artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8, artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d]
- [comment_74d3d1fe-cc7b-4e30-8a83-ba2808919fad] (medium/performance/medium) Micro-benchmark indicates a performance regression. Consider optimizing hot paths or validating with representative load. evidence=[artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad]

================================================================================
AUTO REVIEW (risk-budgeted) — STEP 5: Rendered review (Markdown)
================================================================================
# Vetra Review

Risk: 81/100 (changeSize=23, files=8, sensitivePaths=20, buildOrDeps=15, authnOrCrypto=15)
Budget: deep (modelCalls<=3, dynamicChecks<=3, comments<=10, timeoutMs=120000)

## Knowledge
Issues:
- DEMO-123 — Harden auth normalization
  - AC: Normalization should be idempotent: f(f(x)) == f(x).
  - AC: In strict mode, only issuer "internal" is trusted.

Architecture:
- Architecture Notes (/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/architecture.md)

North Star:
- North Star (/var/folders/qh/sgfds12j32j24dwzxbt9tm4m0000gn/T/vetra-demo-repo-oULlVS/knowledge/north-star.md)

## Plan
- [gather_context] Build PR context model (metadata + diff + risk features).
- [retrieve_knowledge] Retrieve linked issues and repo knowledge (North Star, architecture notes).
- [run_ci] Run tests/CI command: node --test
- [metamorphic] Run metamorphic checks (config-driven specs).
- [mutation] Run diff-scoped mutation testing (limited budget).
- [benchmark] Run performance micro-benchmark: node bench.js
- [llm_review] Invoke verifier model to propose comments (evidence-aware).
- [llm_filter] Verifier pass: evidence-gated filtering + ranking.

## Evidence
- [knowledge] artifact_know_issue_3520dcd4-3b67-4def-bd58-729f6b4a3e3f: Issue DEMO-123 — Harden auth normalization — Acceptance criteria: Normalization should be idempotent: f(f(x)) == f(x). | In strict mode, only issuer "internal" is trusted.
- [knowledge] artifact_know_arch_3961c972-fcdd-4b73-af1a-5a7588be8030: Architecture: Architecture Notes — # Architecture Notes

- `src/auth/*` is security-sensitive.
- Avoid behavior changes without explicit tests.
- [knowledge] artifact_know_ns_8c85961a-8cfc-4646-8b93-a732dc582fc7: North Star: North Star — # North Star

- Prefer evidence-backed feedback (tests, traces, benchmarks).
- Minimize noisy comments; be precision-first.
- Protect auth and security-sensitive surfaces.
- [ci] artifact_ci_1eb665b7-8a01-4f8b-b5e7-5f43824d7a8b: CI/tests passed — Command succeeded: node --test
- [metamorphic] artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c (src/auth/normalize.js): Metamorphic regression: idempotent — src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok).
- [mutation] artifact_mut_summary_415529d5-3ba8-411b-8539-feeccbf6922e: Diff-scoped mutation testing summary — Attempted 3 mutants; survived 3.
- [mutation] artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b (src/auth/normalize.js:7): Surviving mutant (diff-scoped) — src/auth/normalize.js:7 flip_equality survived; consider adding a test/assertion.
- [mutation] artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8 (src/auth/normalize.js:8): Surviving mutant (diff-scoped) — src/auth/normalize.js:8 flip_equality survived; consider adding a test/assertion.
- [mutation] artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d (src/auth/normalize.js:10): Surviving mutant (diff-scoped) — src/auth/normalize.js:10 flip_bool survived; consider adding a test/assertion.
- [benchmark] artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad: Micro-benchmark comparison — base=4, head=22, delta=18 (regression)

## Comments
1. [comment_01883d5b-989e-4ee8-a6e4-ee7f1aee335f] (high/correctness/high) src/auth/normalize.js:normalizeWhitespace violates idempotent on head (base ok).
  - Locations: src/auth/normalize.js
  - Evidence: artifact_meta_1e0fcb1b-13a0-462b-b794-80bd07703d7c
2. [comment_3d2262d2-203c-4940-ae92-66bbb57a65ef] (medium/tests/medium) Some diff-scoped mutants survived (3). This often indicates missing test coverage around changed logic.
  - Locations: src/auth/normalize.js:7, src/auth/normalize.js:8, src/auth/normalize.js:10
  - Evidence: artifact_mut_569f8331-bb66-4b66-ada8-e9d0d745329b, artifact_mut_a374f235-fb3c-4d7f-950d-0337ee7c81d8, artifact_mut_65b3a704-fdb7-4575-868b-391017933d9d
3. [comment_74d3d1fe-cc7b-4e30-8a83-ba2808919fad] (medium/performance/medium) Micro-benchmark indicates a performance regression. Consider optimizing hot paths or validating with representative load.
  - Evidence: artifact_bench_d4ab2481-1872-4157-9e1b-e9e33aeef9ad
```

</details>
