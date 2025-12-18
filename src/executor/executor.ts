import type { PullRequestContext, ReviewComment, ReviewPlan, VetraConfig } from '../types';
import { runBenchmarkComparison } from '../checks/benchmark';
import { runCiCommand } from '../checks/ci';
import { runMetamorphicChecks } from '../checks/metamorphic';
import { runDiffScopedMutationTesting } from '../checks/mutation';
import { createWorktree } from '../git/worktree';
import type { VerifierModel } from '../model/model';

export interface ExecuteResult {
  context: PullRequestContext;
  candidateComments: ReviewComment[];
}

export async function executePlan(
  context: PullRequestContext,
  plan: ReviewPlan,
  config: VetraConfig,
  model: VerifierModel
): Promise<ExecuteResult> {
  const needsHead =
    plan.actions.some((a) => a.kind === 'run_ci' || a.kind === 'mutation' || a.kind === 'metamorphic' || a.kind === 'benchmark') ||
    Boolean(config.commands?.test) ||
    Boolean(config.commands?.benchmark);
  const needsBase = plan.actions.some((a) => a.kind === 'benchmark' || a.kind === 'metamorphic');

  const headWorktree = needsHead ? await createWorktree(context.repoRoot, context.headRef, 'head') : undefined;
  const baseWorktree = needsBase ? await createWorktree(context.repoRoot, context.baseRef, 'base') : undefined;

  try {
    for (const action of plan.actions) {
      if (action.kind === 'run_ci' && config.commands?.test && headWorktree) {
        const { artifact } = await runCiCommand(headWorktree.path, config.commands.test, plan.budget.timeoutMs);
        context.artifacts.push(artifact);
      }

      if (action.kind === 'metamorphic' && baseWorktree && headWorktree) {
        const artifacts = await runMetamorphicChecks(baseWorktree.path, headWorktree.path, context.diff, config);
        context.artifacts.push(...artifacts);
      }

      if (action.kind === 'mutation' && headWorktree) {
        const artifacts = await runDiffScopedMutationTesting(headWorktree.path, context.diff, config, plan.budget.timeoutMs);
        context.artifacts.push(...artifacts);
      }

      if (action.kind === 'benchmark' && baseWorktree && headWorktree && config.commands?.benchmark) {
        const artifact = await runBenchmarkComparison(
          baseWorktree.path,
          headWorktree.path,
          config.commands.benchmark,
          plan.budget.timeoutMs
        );
        context.artifacts.push(artifact);
      }
    }

    const candidateComments = await model.proposeComments({ context, plan });
    return { context, candidateComments };
  } finally {
    await headWorktree?.cleanup();
    await baseWorktree?.cleanup();
  }
}
