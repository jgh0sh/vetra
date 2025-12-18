import type { Diff, RiskFeatures, RiskScore, VetraConfig } from '../types';

const DEFAULT_SENSITIVE_PATTERNS = [
  'auth',
  'oauth',
  'sso',
  'jwt',
  'crypto',
  'hash',
  'password',
  'secrets',
  'payments',
  'billing',
  'pci',
  'gdpr',
  'pii',
  'acl',
  'rbac',
  'iam'
];

const BUILD_OR_DEPS_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile'
]);

function pathMatchesAny(path: string, patterns: string[]): boolean {
  const lower = path.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

export function computeRiskFeatures(diff: Diff, config: VetraConfig): RiskFeatures {
  const filesChanged = diff.files.length;
  const linesAdded = diff.files.reduce((sum, f) => sum + f.additions, 0);
  const linesDeleted = diff.files.reduce((sum, f) => sum + f.deletions, 0);

  const sensitivePatterns = config.planner?.sensitivePathPatterns?.length
    ? config.planner.sensitivePathPatterns
    : DEFAULT_SENSITIVE_PATTERNS;

  const allPaths = diff.files
    .flatMap((f) => [f.newPath, f.oldPath])
    .filter((p): p is string => Boolean(p));

  const touchesSensitivePaths = allPaths.some((p) => pathMatchesAny(p, sensitivePatterns));
  const touchesAuthnOrCrypto = allPaths.some((p) => pathMatchesAny(p, ['auth', 'oauth', 'sso', 'jwt', 'crypto', 'hash']));

  const touchesBuildOrDeps =
    allPaths.some((p) => BUILD_OR_DEPS_FILES.has(p.split('/').pop() ?? '')) ||
    allPaths.some((p) => p.includes('.github/workflows/')) ||
    allPaths.some((p) => p.includes('/infra/')) ||
    allPaths.some((p) => p.includes('/terraform/'));

  return {
    filesChanged,
    linesAdded,
    linesDeleted,
    touchesSensitivePaths,
    touchesBuildOrDeps,
    touchesAuthnOrCrypto
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function computeRiskScore(features: RiskFeatures): RiskScore {
  const breakdown: Record<string, number> = {};

  const size = features.linesAdded + features.linesDeleted;
  breakdown.changeSize = clamp(Math.round(Math.log10(size + 1) * 18), 0, 40);
  breakdown.files = clamp(features.filesChanged * 2, 0, 20);
  breakdown.sensitivePaths = features.touchesSensitivePaths ? 20 : 0;
  breakdown.buildOrDeps = features.touchesBuildOrDeps ? 15 : 0;
  breakdown.authnOrCrypto = features.touchesAuthnOrCrypto ? 15 : 0;

  const total = clamp(Object.values(breakdown).reduce((a, b) => a + b, 0), 0, 100);
  return { total, breakdown };
}

