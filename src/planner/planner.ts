import type { BudgetMode, PlanAction, PullRequestContext, ReviewPlan, VetraConfig } from '../types';
import { newId } from '../utils/ids';
import { deriveBudget } from './budget';
import { computeRiskScore } from './risk';

export function planReview(context: PullRequestContext, config: VetraConfig, overrideMode?: BudgetMode): ReviewPlan {
  const risk = computeRiskScore(context.riskFeatures);
  const budget = deriveBudget(risk, config, overrideMode);

  const actions: PlanAction[] = [];

  actions.push({
    id: newId('action'),
    kind: 'gather_context',
    description: 'Build PR context model (metadata + diff + risk features).',
    estimatedCost: 1
  });

  actions.push({
    id: newId('action'),
    kind: 'retrieve_knowledge',
    description: 'Retrieve linked issues and repo knowledge (North Star, architecture notes).',
    estimatedCost: 1
  });

  if (config.commands?.test) {
    actions.push({
      id: newId('action'),
      kind: 'run_ci',
      description: `Run tests/CI command: ${config.commands.test}`,
      estimatedCost: budget.mode === 'quick' ? 2 : 3,
      params: { command: config.commands.test }
    });
  }

  const hasMetamorphicSpecs = (config.checks?.metamorphic?.specs?.length ?? 0) > 0;
  const metamorphicEnabled = config.checks?.metamorphic?.enabled ?? true;
  if (metamorphicEnabled && hasMetamorphicSpecs && budget.mode !== 'quick') {
    actions.push({
      id: newId('action'),
      kind: 'metamorphic',
      description: 'Run metamorphic checks (config-driven specs).',
      estimatedCost: budget.mode === 'deep' ? 3 : 2
    });
  }

  const mutationEnabled = config.checks?.mutation?.enabled ?? true;
  if (mutationEnabled && budget.mode !== 'quick' && config.commands?.test) {
    actions.push({
      id: newId('action'),
      kind: 'mutation',
      description: 'Run diff-scoped mutation testing (limited budget).',
      estimatedCost: budget.mode === 'deep' ? 3 : 2
    });
  }

  if (budget.mode === 'deep' && config.commands?.benchmark) {
    actions.push({
      id: newId('action'),
      kind: 'benchmark',
      description: `Run performance micro-benchmark: ${config.commands.benchmark}`,
      estimatedCost: 3,
      params: { command: config.commands.benchmark }
    });
  }

  actions.push({
    id: newId('action'),
    kind: 'llm_review',
    description: 'Invoke verifier model to propose comments (evidence-aware).',
    estimatedCost: 2
  });

  actions.push({
    id: newId('action'),
    kind: 'llm_filter',
    description: 'Verifier pass: evidence-gated filtering + ranking.',
    estimatedCost: 1
  });

  return { risk, budget, actions };
}
