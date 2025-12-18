import type { Confidence, PullRequestContext, ReviewComment, ReviewPlan, Severity } from '../types';

export type CommentCheckDecisionType = 'keep' | 'drop';

export interface CommentCheckDecision {
  id: string;
  decision: CommentCheckDecisionType;
  reason: string;
  severity?: Severity;
  confidence?: Confidence;
}

export interface CheckCommentsInput {
  context: PullRequestContext;
  plan: ReviewPlan;
  comments: ReviewComment[];
}

export interface CommentChecker {
  name: string;
  checkComments(input: CheckCommentsInput): Promise<CommentCheckDecision[]>;
}

