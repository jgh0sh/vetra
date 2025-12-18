import type { BudgetMode, ReviewBudget, RiskScore, VetraConfig } from '../types';

export function deriveBudget(risk: RiskScore, config: VetraConfig, overrideMode?: BudgetMode): ReviewBudget {
  const requireEvidenceForHighSeverity = config.verifier?.requireEvidenceForHighSeverity ?? true;
  const maxComments = config.verifier?.maxComments ?? 12;

  const mode: BudgetMode =
    overrideMode ??
    (risk.total >= 65 ? 'deep' : risk.total >= 30 ? 'standard' : ('quick' satisfies BudgetMode));

  if (mode === 'quick') {
    return {
      mode,
      maxModelCalls: 1,
      maxDynamicChecks: 1,
      maxComments: Math.min(maxComments, requireEvidenceForHighSeverity ? 8 : 10),
      timeoutMs: 30_000
    };
  }

  if (mode === 'standard') {
    return {
      mode,
      maxModelCalls: 2,
      maxDynamicChecks: 2,
      maxComments: Math.min(maxComments, requireEvidenceForHighSeverity ? 12 : 15),
      timeoutMs: 60_000
    };
  }

  return {
    mode,
    maxModelCalls: 3,
    maxDynamicChecks: 3,
    maxComments: Math.min(maxComments, requireEvidenceForHighSeverity ? 15 : 20),
    timeoutMs: 120_000
  };
}

