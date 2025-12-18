import test from 'node:test';
import assert from 'node:assert/strict';
import type { PullRequestContext, ReviewComment, ReviewPlan, VetraConfig } from '../src/types';
import { verifyAndRankComments } from '../src/verifier/verifier';

test('verifyAndRankComments downgrades high severity without evidence', () => {
  const ctx: PullRequestContext = {
    meta: { id: 'x', title: 't' },
    baseRef: 'a',
    headRef: 'b',
    repoRoot: '.',
    diff: { files: [] },
    riskFeatures: {
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      touchesSensitivePaths: false,
      touchesBuildOrDeps: false,
      touchesAuthnOrCrypto: false
    },
    knowledge: { issues: [], architectureNotes: [], northStar: [], precedent: [] },
    artifacts: []
  };

  const plan: ReviewPlan = {
    risk: { total: 10, breakdown: { changeSize: 1 } },
    budget: { mode: 'quick', maxModelCalls: 1, maxDynamicChecks: 1, maxComments: 10, timeoutMs: 1000 },
    actions: []
  };

  const candidate: ReviewComment[] = [
    {
      id: 'c1',
      category: 'correctness',
      severity: 'high',
      confidence: 'high',
      message: 'This is severe but unproven',
      locations: [],
      evidence: []
    }
  ];

  const config: VetraConfig = { verifier: { requireEvidenceForHighSeverity: true } };
  const out = verifyAndRankComments(ctx, plan, candidate, config);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'medium');
});

test('verifyAndRankComments ignores unknown evidence ids', () => {
  const ctx: PullRequestContext = {
    meta: { id: 'x', title: 't' },
    baseRef: 'a',
    headRef: 'b',
    repoRoot: '.',
    diff: { files: [] },
    riskFeatures: {
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      touchesSensitivePaths: false,
      touchesBuildOrDeps: false,
      touchesAuthnOrCrypto: false
    },
    knowledge: { issues: [], architectureNotes: [], northStar: [], precedent: [] },
    artifacts: [
      { id: 'artifact_real', type: 'ci', title: 'ok', summary: 'ok', createdAt: new Date().toISOString(), raw: {} }
    ]
  };

  const plan: ReviewPlan = {
    risk: { total: 10, breakdown: { changeSize: 1 } },
    budget: { mode: 'quick', maxModelCalls: 1, maxDynamicChecks: 1, maxComments: 10, timeoutMs: 1000 },
    actions: []
  };

  const candidate: ReviewComment[] = [
    {
      id: 'c1',
      category: 'correctness',
      severity: 'high',
      confidence: 'high',
      message: 'Claims to have evidence but id is fake',
      locations: [],
      evidence: [{ artifactId: 'artifact_fake' }]
    }
  ];

  const config: VetraConfig = { verifier: { requireEvidenceForHighSeverity: true } };
  const out = verifyAndRankComments(ctx, plan, candidate, config);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'medium');
});
