import type { EvidenceArtifact, ReviewComment } from '../types';
import { newId } from '../utils/ids';
import type { ProposeCommentsInput, VerifierModel } from './model';

function evidenceRef(artifact: EvidenceArtifact) {
  return { artifactId: artifact.id };
}

function findFirst(artifacts: EvidenceArtifact[], type: EvidenceArtifact['type']): EvidenceArtifact | undefined {
  return artifacts.find((a) => a.type === type);
}

export class HeuristicVerifierModel implements VerifierModel {
  name = 'heuristic';

  async proposeComments(input: ProposeCommentsInput): Promise<ReviewComment[]> {
    const artifacts = input.context.artifacts;
    const comments: ReviewComment[] = [];

    const ci = findFirst(artifacts, 'ci');
    if (ci && /failed/i.test(ci.title)) {
      comments.push({
        id: newId('comment'),
        category: 'correctness',
        severity: 'high',
        confidence: 'high',
        message: 'CI/tests failed on this change. Fix the failures or update tests to match the new behavior.',
        locations: [],
        evidence: [evidenceRef(ci)]
      });
    }

    for (const artifact of artifacts) {
      if (artifact.type === 'metamorphic' && /regression/i.test(artifact.title)) {
        comments.push({
          id: newId('comment'),
          category: 'correctness',
          severity: 'high',
          confidence: 'high',
          message: artifact.summary,
          locations: artifact.file ? [{ file: artifact.file, line: artifact.line }] : [],
          evidence: [evidenceRef(artifact)]
        });
      }
    }

    const mutationFindings = artifacts.filter((a) => a.type === 'mutation' && /Surviving mutant/i.test(a.title));
    if (mutationFindings.length > 0) {
      const top = mutationFindings.slice(0, 5);
      comments.push({
        id: newId('comment'),
        category: 'tests',
        severity: 'medium',
        confidence: 'medium',
        message: `Some diff-scoped mutants survived (${mutationFindings.length}). This often indicates missing test coverage around changed logic.`,
        locations: top.flatMap((a) => (a.file ? [{ file: a.file, line: a.line }] : [])),
        evidence: top.map(evidenceRef)
      });
    }

    const bench = findFirst(artifacts, 'benchmark');
    if (bench && /regression/i.test(bench.summary)) {
      comments.push({
        id: newId('comment'),
        category: 'performance',
        severity: 'medium',
        confidence: 'medium',
        message: 'Micro-benchmark indicates a performance regression. Consider optimizing hot paths or validating with representative load.',
        locations: [],
        evidence: [evidenceRef(bench)]
      });
    }

    // If there is nothing else, keep output sparse (precision-first).
    return comments;
  }
}
