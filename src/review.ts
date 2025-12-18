import type { BudgetMode, PullRequestMetadata, ReviewResult, VetraConfig } from './types';
import { buildPullRequestContext } from './context/build';
import { executePlan } from './executor/executor';
import { HeuristicVerifierModel } from './model/heuristic';
import type { VerifierModel } from './model/model';
import { planReview } from './planner/planner';
import { formatReviewMarkdown } from './format/markdown';
import { verifyAndRankComments } from './verifier/verifier';

export interface ReviewRequest {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  meta: PullRequestMetadata;
  config: VetraConfig;
  budgetMode?: BudgetMode;
  model?: VerifierModel;
}

export async function runReview(request: ReviewRequest): Promise<ReviewResult> {
  const context = await buildPullRequestContext({
    repoRoot: request.repoRoot,
    baseRef: request.baseRef,
    headRef: request.headRef,
    meta: request.meta,
    config: request.config
  });

  const plan = planReview(context, request.config, request.budgetMode);
  const model = request.model ?? new HeuristicVerifierModel();

  const execRes = await executePlan(context, plan, request.config, model);
  const finalComments = verifyAndRankComments(execRes.context, plan, execRes.candidateComments, request.config);

  const summaryMarkdown = formatReviewMarkdown(plan, execRes.context.knowledge, execRes.context.artifacts, finalComments);

  return {
    plan,
    comments: finalComments,
    artifacts: execRes.context.artifacts,
    summaryMarkdown
  };
}
