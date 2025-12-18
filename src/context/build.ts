import type { PullRequestContext, PullRequestMetadata, VetraConfig } from '../types';
import { getUnifiedDiff } from '../git/git';
import { knowledgeToArtifacts, loadKnowledgeContext } from '../knowledge/knowledge';
import { computeRiskFeatures } from '../planner/risk';

export interface BuildContextInput {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  meta: PullRequestMetadata;
  config: VetraConfig;
}

export async function buildPullRequestContext(input: BuildContextInput): Promise<PullRequestContext> {
  const diff = await getUnifiedDiff(input.repoRoot, input.baseRef, input.headRef);
  const riskFeatures = computeRiskFeatures(diff, input.config);
  const knowledge = await loadKnowledgeContext(input.repoRoot, input.meta, diff, input.config);
  const knowledgeArtifacts = knowledgeToArtifacts(knowledge);

  return {
    meta: input.meta,
    repoRoot: input.repoRoot,
    baseRef: input.baseRef,
    headRef: input.headRef,
    diff,
    riskFeatures,
    knowledge,
    artifacts: [...knowledgeArtifacts]
  };
}
