import type { PullRequestContext, ReviewComment, ReviewPlan, Severity, VetraConfig } from '../types';
import { newId } from '../utils/ids';

function severityScore(sev: Severity): number {
  if (sev === 'high') return 100;
  if (sev === 'medium') return 50;
  return 10;
}

function confidenceScore(conf: ReviewComment['confidence']): number {
  if (conf === 'high') return 10;
  if (conf === 'medium') return 5;
  return 1;
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function verifyAndRankComments(
  context: PullRequestContext,
  plan: ReviewPlan,
  candidate: ReviewComment[],
  config: VetraConfig
): ReviewComment[] {
  const requireEvidenceForHigh = config.verifier?.requireEvidenceForHighSeverity ?? true;
  const maxComments = config.verifier?.maxComments ?? plan.budget.maxComments;

  const validArtifactIds = new Set(context.artifacts.map((a) => a.id));

  const normalized = candidate
    .map((c) => {
      const filteredEvidence = c.evidence.filter((e) => validArtifactIds.has(e.artifactId));
      const withValidEvidence: ReviewComment = { ...c, evidence: filteredEvidence };

      if (requireEvidenceForHigh && withValidEvidence.severity === 'high' && withValidEvidence.evidence.length === 0) {
        return {
          ...withValidEvidence,
          id: newId('comment'),
          severity: 'medium' as const,
          confidence: withValidEvidence.confidence === 'high' ? 'medium' : withValidEvidence.confidence
        };
      }
      return withValidEvidence;
    })
    .filter((c) => (requireEvidenceForHigh && c.severity === 'high' ? c.evidence.length > 0 : true));

  // Aggregate duplicates by category+message.
  const byKey = new Map<string, ReviewComment>();
  for (const c of normalized) {
    const key = `${c.category}::${c.message}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...c, locations: [...c.locations], evidence: [...c.evidence] });
      continue;
    }
    existing.locations.push(...c.locations);
    existing.evidence.push(...c.evidence);
    existing.locations = uniqueBy(existing.locations, (l) => `${l.file}:${l.line ?? ''}`);
    existing.evidence = uniqueBy(existing.evidence, (e) => e.artifactId);
  }

  const aggregated = [...byKey.values()];

  const scored = aggregated
    .map((c) => {
      const score =
        severityScore(c.severity) +
        confidenceScore(c.confidence) +
        (c.evidence.length > 0 ? 20 : 0) +
        Math.round(plan.risk.total / 10);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.c);

  return scored.slice(0, maxComments);
}
