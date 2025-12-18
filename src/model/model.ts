import type { PullRequestContext, ReviewComment, ReviewPlan } from '../types';

export interface ProposeCommentsInput {
  context: PullRequestContext;
  plan: ReviewPlan;
}

export interface VerifierModel {
  name: string;
  proposeComments(input: ProposeCommentsInput): Promise<ReviewComment[]>;
}

