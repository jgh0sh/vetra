import test from 'node:test';
import assert from 'node:assert/strict';
import type { Diff, VetraConfig } from '../src/types';
import { computeRiskFeatures, computeRiskScore } from '../src/planner/risk';

test('computeRiskScore increases for sensitive paths', () => {
  const diff: Diff = {
    files: [
      {
        oldPath: 'src/auth/login.ts',
        newPath: 'src/auth/login.ts',
        hunks: [],
        additions: 10,
        deletions: 1,
        isNew: false,
        isDeleted: false,
        language: 'typescript'
      }
    ]
  };

  const config: VetraConfig = {};
  const features = computeRiskFeatures(diff, config);
  const risk = computeRiskScore(features);

  assert.equal(features.touchesSensitivePaths, true);
  assert.ok(risk.total >= 20);
});

