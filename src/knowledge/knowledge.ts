import { resolve } from 'node:path';
import type { Diff, EvidenceArtifact, KnowledgeContext, PullRequestMetadata, VetraConfig } from '../types';
import { readJsonIfExists, readTextIfExists } from '../utils/fs';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/time';

type IssuesJson = Record<
  string,
  {
    title?: string;
    acceptanceCriteria?: string[];
    url?: string;
    raw?: unknown;
  }
>;

function extractIssueKeys(text: string): string[] {
  const keys = new Set<string>();
  const re = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
  for (const match of text.matchAll(re)) {
    keys.add(match[0]);
  }
  return [...keys];
}

function excerptMarkdown(md: string, maxChars: number): string {
  const cleaned = md.replace(/\r\n/g, '\n').trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars).trimEnd()}\n…`;
}

export async function loadKnowledgeContext(
  repoRoot: string,
  meta: PullRequestMetadata,
  diff: Diff,
  config: VetraConfig
): Promise<KnowledgeContext> {
  const issueKeys = extractIssueKeys([meta.title, meta.description ?? ''].join('\n'));

  const issuesDbPath = config.knowledge?.issuesJsonPath ? resolve(repoRoot, config.knowledge.issuesJsonPath) : undefined;
  const issuesDb = issuesDbPath ? await readJsonIfExists<IssuesJson>(issuesDbPath) : undefined;

  const issues = issueKeys.map((key) => ({ key, ...(issuesDb?.[key] ?? {}) }));

  const northStarPath = config.knowledge?.northStarMarkdownPath
    ? resolve(repoRoot, config.knowledge.northStarMarkdownPath)
    : undefined;
  const architecturePath = config.knowledge?.architectureMarkdownPath
    ? resolve(repoRoot, config.knowledge.architectureMarkdownPath)
    : undefined;

  const [northStarMd, architectureMd] = await Promise.all([
    northStarPath ? readTextIfExists(northStarPath) : Promise.resolve(undefined),
    architecturePath ? readTextIfExists(architecturePath) : Promise.resolve(undefined)
  ]);

  return {
    issues,
    architectureNotes: architectureMd
      ? [
          {
            title: 'Architecture Notes',
            excerpt: excerptMarkdown(architectureMd, 1400),
            source: architecturePath
          }
        ]
      : [],
    northStar: northStarMd
      ? [
          {
            title: 'North Star',
            excerpt: excerptMarkdown(northStarMd, 1400),
            source: northStarPath
          }
        ]
      : [],
    precedent: []
  };
}

export function knowledgeToArtifacts(knowledge: KnowledgeContext): EvidenceArtifact[] {
  const createdAt = nowIso();

  const issueArtifacts: EvidenceArtifact[] = knowledge.issues.map((issue) => ({
    id: newId('artifact_know_issue'),
    type: 'knowledge',
    title: `Issue ${issue.key}${issue.title ? ` — ${issue.title}` : ''}`,
    summary: (issue.acceptanceCriteria ?? []).length > 0 ? `Acceptance criteria: ${(issue.acceptanceCriteria ?? []).join(' | ')}` : 'Issue linked.',
    createdAt,
    raw: issue
  }));

  const architectureArtifacts: EvidenceArtifact[] = knowledge.architectureNotes.map((note) => ({
    id: newId('artifact_know_arch'),
    type: 'knowledge',
    title: `Architecture: ${note.title}`,
    summary: note.excerpt.slice(0, 400),
    createdAt,
    raw: note
  }));

  const northStarArtifacts: EvidenceArtifact[] = knowledge.northStar.map((note) => ({
    id: newId('artifact_know_ns'),
    type: 'knowledge',
    title: `North Star: ${note.title}`,
    summary: note.excerpt.slice(0, 400),
    createdAt,
    raw: note
  }));

  const precedentArtifacts: EvidenceArtifact[] = knowledge.precedent.map((p) => ({
    id: newId('artifact_know_prec'),
    type: 'knowledge',
    title: 'Precedent PR',
    summary: p.summary,
    createdAt,
    raw: p
  }));

  return [...issueArtifacts, ...architectureArtifacts, ...northStarArtifacts, ...precedentArtifacts];
}
