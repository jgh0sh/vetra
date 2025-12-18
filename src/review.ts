import type { BudgetMode, PullRequestMetadata, ReviewResult, VetraConfig } from './types';
import { buildPullRequestContext } from './context/build';
import { executePlan } from './executor/executor';
import { HeuristicVerifierModel } from './model/heuristic';
import type { CommentChecker } from './model/checker';
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
  checker?: CommentChecker;
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

  let checkedComments = execRes.candidateComments;
  if (request.checker && execRes.candidateComments.length > 0) {
    const modelCallsUsed = model.name === 'heuristic' ? 0 : 1;
    const needsCalls = modelCallsUsed + 1;
    if (plan.budget.maxModelCalls >= needsCalls) {
      try {
        const decisions = await request.checker.checkComments({ context: execRes.context, plan, comments: execRes.candidateComments });
        const byId = new Map(decisions.map((d) => [d.id, d]));
        checkedComments = execRes.candidateComments
          .map((c) => {
            const d = byId.get(c.id);
            if (!d) return c;
            if (d.decision === 'drop') return undefined;
            return {
              ...c,
              severity: d.severity ?? c.severity,
              confidence: d.confidence ?? c.confidence
            };
          })
          .filter((c): c is NonNullable<typeof c> => Boolean(c));
      } catch {
        // If checker fails, fall back to un-checked candidates (precision-first gating still applies below).
        checkedComments = execRes.candidateComments;
      }
    }
  }

  const finalComments = verifyAndRankComments(execRes.context, plan, checkedComments, request.config);

  const summaryMarkdown = formatReviewMarkdown(plan, execRes.context.knowledge, execRes.context.artifacts, finalComments);

  return {
    plan,
    comments: finalComments,
    artifacts: execRes.context.artifacts,
    summaryMarkdown
  };
}
