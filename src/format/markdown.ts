import type { EvidenceArtifact, KnowledgeContext, ReviewBudget, ReviewComment, ReviewPlan, RiskScore } from '../types';

function renderRisk(risk: RiskScore): string {
  const parts = Object.entries(risk.breakdown)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `Risk: ${risk.total}/100 (${parts})`;
}

function renderBudget(budget: ReviewBudget): string {
  return `Budget: ${budget.mode} (modelCalls<=${budget.maxModelCalls}, dynamicChecks<=${budget.maxDynamicChecks}, comments<=${budget.maxComments}, timeoutMs=${budget.timeoutMs})`;
}

function renderKnowledge(knowledge: KnowledgeContext): string {
  const hasAnything =
    knowledge.issues.length > 0 || knowledge.architectureNotes.length > 0 || knowledge.northStar.length > 0 || knowledge.precedent.length > 0;
  if (!hasAnything) return 'No knowledge context loaded.';

  const out: string[] = [];

  if (knowledge.issues.length > 0) {
    out.push('Issues:');
    for (const issue of knowledge.issues) {
      const title = issue.title ? ` — ${issue.title}` : '';
      out.push(`- ${issue.key}${title}`);
      const ac = issue.acceptanceCriteria ?? [];
      for (const line of ac.slice(0, 6)) out.push(`  - AC: ${line}`);
    }
  }

  if (knowledge.architectureNotes.length > 0) {
    out.push('');
    out.push('Architecture:');
    for (const note of knowledge.architectureNotes) {
      const src = note.source ? ` (${note.source})` : '';
      out.push(`- ${note.title}${src}`);
    }
  }

  if (knowledge.northStar.length > 0) {
    out.push('');
    out.push('North Star:');
    for (const note of knowledge.northStar) {
      const src = note.source ? ` (${note.source})` : '';
      out.push(`- ${note.title}${src}`);
    }
  }

  if (knowledge.precedent.length > 0) {
    out.push('');
    out.push('Precedent:');
    for (const p of knowledge.precedent.slice(0, 5)) {
      out.push(`- ${p.summary}${p.url ? ` (${p.url})` : ''}`);
    }
  }

  return out.join('\n').trimEnd();
}

function renderArtifacts(artifacts: EvidenceArtifact[]): string {
  if (artifacts.length === 0) return 'No evidence artifacts produced.';
  return artifacts
    .map((a) => {
      const loc = a.file ? ` (${a.file}${a.line ? `:${a.line}` : ''})` : '';
      return `- [${a.type}] ${a.id}${loc}: ${a.title} — ${a.summary}`;
    })
    .join('\n');
}

function renderComments(comments: ReviewComment[]): string {
  if (comments.length === 0) return 'No comments (precision-first).';
  return comments
    .map((c, idx) => {
      const loc =
        c.locations.length === 0
          ? ''
          : `\n  - Locations: ${c.locations.map((l) => `${l.file}${l.line ? `:${l.line}` : ''}`).join(', ')}`;
      const ev = c.evidence.length === 0 ? '' : `\n  - Evidence: ${c.evidence.map((e) => e.artifactId).join(', ')}`;
      const fix = c.suggestedFix ? `\n  - Suggested fix: ${c.suggestedFix}` : '';
      return `${idx + 1}. [${c.id}] (${c.severity}/${c.category}/${c.confidence}) ${c.message}${loc}${ev}${fix}`;
    })
    .join('\n');
}

export function formatReviewMarkdown(
  plan: ReviewPlan,
  knowledge: KnowledgeContext,
  artifacts: EvidenceArtifact[],
  comments: ReviewComment[]
): string {
  const actions = plan.actions.map((a) => `- [${a.kind}] ${a.description}`).join('\n');

  return [
    '# Vetra Review',
    '',
    renderRisk(plan.risk),
    renderBudget(plan.budget),
    '',
    '## Knowledge',
    renderKnowledge(knowledge),
    '',
    '## Plan',
    actions || '- (none)',
    '',
    '## Evidence',
    renderArtifacts(artifacts),
    '',
    '## Comments',
    renderComments(comments),
    ''
  ].join('\n');
}
