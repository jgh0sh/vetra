import type { EvidenceArtifact, KnowledgeContext, PullRequestContext, ReviewComment, ReviewPlan } from '../types';
import { newId } from '../utils/ids';
import type { CommentCheckDecision } from './checker';
import type { CheckCommentsInput, CommentChecker } from './checker';
import type { ProposeCommentsInput, VerifierModel } from './model';

export interface OpenAIModelOptions {
  apiKey: string;
  model: string;
  baseUrl?: string; // default: https://api.openai.com
}

const REVIEW_SYSTEM_PROMPT = [
  'You are Vetra, a precision-first pull request verifier.',
  '',
  'You receive a PR diff, repo knowledge, and evidence artifacts from automated checks.',
  'Your job is to produce a small number of correct, actionable review comments.',
  '',
  'Hard requirements:',
  '- Output ONLY valid JSON.',
  '- Never invent evidence artifactIds; only cite ids that appear in the Evidence list.',
  '- If severity is "high", include >=1 Evidence artifactId that directly supports the claim.',
  '- If a comment is about requirements/architecture, cite a relevant "knowledge" artifactId when available.',
  '- Do not guess line numbers; omit line if unsure.',
  '',
  'Style:',
  '- Prefer correctness/security/performance/test gaps over style.',
  '- Be concise and specific; suggest concrete fixes when possible.',
  '- Avoid nitpicks and speculative concerns.'
].join('\n');

const CHECKER_SYSTEM_PROMPT = [
  'You are Vetra-Checker, a strict verifier for candidate code review comments.',
  '',
  'Goal: maximize precision. Keep only comments that are clearly correct and supported by the provided context.',
  '',
  'Rules:',
  '- If uncertain, DROP the comment.',
  '- If a comment cites evidence, it must be relevant and present in the Evidence list.',
  '- If a comment is marked "high" but not strongly supported by evidence, downgrade severity to "medium" or drop it.',
  '- Do not invent artifactIds, code, or behavior. Use only what is provided.',
  '',
  'Output ONLY valid JSON.'
].join('\n');

function renderKnowledgeForPrompt(knowledge: KnowledgeContext): string {
  const out: string[] = [];

  if (knowledge.issues.length > 0) {
    out.push('Issues:');
    for (const issue of knowledge.issues) {
      out.push(`- ${issue.key}${issue.title ? `: ${issue.title}` : ''}`);
      const ac = issue.acceptanceCriteria ?? [];
      for (const line of ac.slice(0, 8)) out.push(`  - AC: ${line}`);
    }
    out.push('');
  }

  if (knowledge.architectureNotes.length > 0) {
    out.push('Architecture notes (excerpts):');
    for (const note of knowledge.architectureNotes) {
      out.push(`- ${note.title}${note.source ? ` (${note.source})` : ''}`);
      out.push(note.excerpt);
      out.push('');
    }
  }

  if (knowledge.northStar.length > 0) {
    out.push('North Star (excerpts):');
    for (const note of knowledge.northStar) {
      out.push(`- ${note.title}${note.source ? ` (${note.source})` : ''}`);
      out.push(note.excerpt);
      out.push('');
    }
  }

  if (knowledge.precedent.length > 0) {
    out.push('Precedent:');
    for (const p of knowledge.precedent.slice(0, 5)) out.push(`- ${p.summary}${p.url ? ` (${p.url})` : ''}`);
  }

  return out.join('\n').trim().slice(0, 10_000);
}

function renderDiffSummaryForPrompt(context: PullRequestContext): string {
  return context.diff.files
    .map((f) => {
      const path = f.newPath ?? f.oldPath ?? '(unknown)';
      return `- ${path} (+${f.additions}/-${f.deletions})`;
    })
    .join('\n')
    .slice(0, 4000);
}

function renderDiffForPrompt(context: PullRequestContext): string {
  const parts: string[] = [];
  for (const file of context.diff.files) {
    const path = file.newPath ?? file.oldPath ?? '(unknown)';
    parts.push(`File: ${path} (+${file.additions}/-${file.deletions})`);
    for (const hunk of file.hunks) {
      parts.push(hunk.header);
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        parts.push(`${prefix}${line.content}`);
      }
    }
    parts.push('');
  }
  return parts.join('\n').slice(0, 25_000);
}

function safeJson(value: unknown, maxChars: number): string {
  try {
    const s = JSON.stringify(value);
    if (s.length <= maxChars) return s;
    return `${s.slice(0, maxChars)}…`;
  } catch {
    return '"<unserializable>"';
  }
}

function renderArtifacts(artifacts: EvidenceArtifact[]): string {
  return artifacts
    .map((a) => {
      const loc = a.file ? ` (${a.file}${a.line ? `:${a.line}` : ''})` : '';
      const details =
        a.type === 'ci' || a.raw === undefined ? '' : ` | raw=${safeJson(a.raw, a.type === 'knowledge' ? 1200 : 800)}`;
      return `${a.id} [${a.type}] ${a.title}${loc}: ${a.summary}${details}`;
    })
    .join('\n')
    .slice(0, 12_000);
}

function renderDiffExcerptForFile(context: PullRequestContext, filePath: string, aroundLine?: number): string | undefined {
  const file = context.diff.files.find((f) => f.newPath === filePath || f.oldPath === filePath);
  if (!file) return undefined;

  const pickHunk = () => {
    if (typeof aroundLine !== 'number') return file.hunks[0];
    return file.hunks.find((h) => aroundLine >= h.newStart && aroundLine < h.newStart + h.newLines) ?? file.hunks[0];
  };

  const hunk = pickHunk();
  if (!hunk) return undefined;

  const rendered = [
    `File: ${file.newPath ?? file.oldPath ?? filePath} (+${file.additions}/-${file.deletions})`,
    hunk.header,
    ...hunk.lines.map((l) => `${l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}${l.content}`)
  ].join('\n');

  return rendered.slice(0, 2000);
}

function renderCommentCandidatesForPrompt(context: PullRequestContext, comments: ReviewComment[]): string {
  return comments
    .map((c) => {
      const loc = c.locations.length > 0 ? c.locations.map((l) => `${l.file}${l.line ? `:${l.line}` : ''}`).join(', ') : '(none)';
      const ev = c.evidence.length > 0 ? c.evidence.map((e) => e.artifactId).join(', ') : '(none)';

      const filesForExcerpt = new Set<string>();
      for (const l of c.locations) filesForExcerpt.add(l.file);
      for (const e of c.evidence) {
        const a = context.artifacts.find((x) => x.id === e.artifactId);
        if (a?.file) filesForExcerpt.add(a.file);
      }

      const excerpts = [...filesForExcerpt]
        .slice(0, 3)
        .map((filePath) => {
          const line = c.locations.find((l) => l.file === filePath)?.line;
          const excerpt = renderDiffExcerptForFile(context, filePath, line);
          return excerpt ? `\n---\n${excerpt}` : '';
        })
        .join('');

      return [
        `- id: ${c.id}`,
        `  category: ${c.category}`,
        `  severity: ${c.severity}`,
        `  confidence: ${c.confidence}`,
        `  message: ${c.message}`,
        `  locations: ${loc}`,
        `  evidence: ${ev}`,
        excerpts ? `  diffExcerpts:${excerpts.replace(/\n/g, '\n  ')}` : undefined,
        c.suggestedFix ? `  suggestedFix: ${c.suggestedFix}` : undefined
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n')
    .slice(0, 10_000);
}

function coerceComment(raw: any): ReviewComment | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const category = raw.category;
  const severity = raw.severity;
  const confidence = raw.confidence;
  const message = raw.message;

  if (typeof message !== 'string') return undefined;
  if (!['correctness', 'security', 'performance', 'tests', 'maintainability', 'architecture', 'style', 'docs'].includes(category))
    return undefined;
  if (!['high', 'medium', 'low'].includes(severity)) return undefined;
  if (!['high', 'medium', 'low'].includes(confidence)) return undefined;

  const locations = Array.isArray(raw.locations)
    ? raw.locations
        .map((l: any) => ({ file: l?.file, line: l?.line }))
        .filter((l: any) => typeof l.file === 'string')
        .map((l: any) => ({ file: l.file as string, line: typeof l.line === 'number' ? (l.line as number) : undefined }))
    : [];

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .map((e: any) => ({ artifactId: e?.artifactId ?? e }))
        .filter((e: any) => typeof e.artifactId === 'string')
    : [];

  return {
    id: typeof raw.id === 'string' ? raw.id : newId('comment'),
    category,
    severity,
    confidence,
    message,
    locations,
    evidence,
    suggestedFix: typeof raw.suggestedFix === 'string' ? raw.suggestedFix : undefined
  };
}

export class OpenAIChatVerifierModel implements VerifierModel {
  name = 'openai';

  constructor(private options: OpenAIModelOptions) {}

  async proposeComments(input: ProposeCommentsInput): Promise<ReviewComment[]> {
    const baseUrl = (this.options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');

    const userPrompt = [
      `PR Title: ${input.context.meta.title}`,
      input.context.meta.description ? `PR Description: ${input.context.meta.description}` : undefined,
      '',
      `Risk: ${input.plan.risk.total}/100`,
      `Risk breakdown: ${safeJson(input.plan.risk.breakdown, 1000)}`,
      `Risk features: ${safeJson(input.context.riskFeatures, 1000)}`,
      `Budget: mode=${input.plan.budget.mode}, maxComments=${input.plan.budget.maxComments}`,
      '',
      'Repo/Org Knowledge:',
      renderKnowledgeForPrompt(input.context.knowledge) || '(none)',
      '',
      'Evidence (artifactId [type] title (file:line): summary | raw=...):',
      renderArtifacts(input.context.artifacts) || '(none)',
      '',
      'Diff (unified, truncated):',
      renderDiffForPrompt(input.context),
      '',
      'Output format:',
      'Return ONLY valid JSON: { "comments": ReviewComment[] } where ReviewComment has:',
      '{ id?: string, category, severity, confidence, message, locations?: [{file, line?}], evidence?: [{artifactId}], suggestedFix?: string }'
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return [];

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI response was not valid JSON. Content:\n${content.slice(0, 2000)}`);
    }

    const rawComments: unknown[] = Array.isArray(parsed?.comments) ? (parsed.comments as unknown[]) : [];
    const coerced = rawComments.map((rc) => coerceComment(rc)).filter((c): c is ReviewComment => Boolean(c));
    return coerced;
  }
}

function coerceDecision(raw: any): CommentCheckDecision | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (typeof raw.id !== 'string') return undefined;
  if (raw.decision !== 'keep' && raw.decision !== 'drop') return undefined;
  if (typeof raw.reason !== 'string') return undefined;

  const severity = raw.severity;
  const confidence = raw.confidence;

  return {
    id: raw.id,
    decision: raw.decision,
    reason: raw.reason,
    severity: severity === 'high' || severity === 'medium' || severity === 'low' ? severity : undefined,
    confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : undefined
  };
}

export class OpenAIChatCommentChecker implements CommentChecker {
  name = 'openai_checker';

  constructor(private options: OpenAIModelOptions) {}

  async checkComments(input: CheckCommentsInput): Promise<CommentCheckDecision[]> {
    const baseUrl = (this.options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');

    const userPrompt = [
      `PR Title: ${input.context.meta.title}`,
      input.context.meta.description ? `PR Description: ${input.context.meta.description}` : undefined,
      '',
      `Risk: ${input.plan.risk.total}/100`,
      `Risk breakdown: ${safeJson(input.plan.risk.breakdown, 1000)}`,
      `Risk features: ${safeJson(input.context.riskFeatures, 1000)}`,
      `Budget: mode=${input.plan.budget.mode}, maxComments=${input.plan.budget.maxComments}`,
      '',
      'Repo/Org Knowledge:',
      renderKnowledgeForPrompt(input.context.knowledge) || '(none)',
      '',
      'Evidence (artifactId [type] title (file:line): summary | raw=...):',
      renderArtifacts(input.context.artifacts) || '(none)',
      '',
      'Diff summary:',
      renderDiffSummaryForPrompt(input.context) || '(none)',
      '',
      'Candidate comments:',
      renderCommentCandidatesForPrompt(input.context, input.comments) || '(none)',
      '',
      'Task:',
      'For each candidate comment, decide whether to keep or drop it. Optionally downgrade severity/confidence when appropriate.',
      '',
      'Output format:',
      'Return ONLY valid JSON: { "decisions": Array<{ id: string, decision: "keep"|"drop", reason: string, severity?: "high"|"medium"|"low", confidence?: "high"|"medium"|"low" }> }'
    ]
      .filter(Boolean)
      .join('\n');

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: 'system', content: CHECKER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI checker request failed: ${res.status} ${res.statusText} ${text}`.trim());
    }

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return [];

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`OpenAI checker response was not valid JSON. Content:\n${content.slice(0, 2000)}`);
    }

    const rawDecisions: unknown[] = Array.isArray(parsed?.decisions) ? (parsed.decisions as unknown[]) : [];
    return rawDecisions.map((d) => coerceDecision(d)).filter((d): d is CommentCheckDecision => Boolean(d));
  }
}
