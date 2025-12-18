export type Severity = 'high' | 'medium' | 'low';
export type Confidence = 'high' | 'medium' | 'low';

export type CommentCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'tests'
  | 'maintainability'
  | 'architecture'
  | 'style'
  | 'docs';

export interface PullRequestMetadata {
  id: string;
  title: string;
  description?: string;
  author?: string;
  labels?: string[];
  source?: 'local' | 'github';
  createdAt?: string;
}

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath?: string;
  newPath?: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
  language?: string;
}

export interface Diff {
  files: DiffFile[];
}

export interface RiskFeatures {
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  touchesSensitivePaths: boolean;
  touchesBuildOrDeps: boolean;
  touchesAuthnOrCrypto: boolean;
}

export interface RiskScore {
  total: number; // 0..100
  breakdown: Record<string, number>;
}

export type EvidenceType = 'ci' | 'metamorphic' | 'mutation' | 'benchmark' | 'knowledge';

export interface EvidenceRef {
  artifactId: string;
  note?: string;
}

export interface EvidenceArtifact {
  id: string;
  type: EvidenceType;
  title: string;
  summary: string;
  createdAt: string;
  file?: string;
  line?: number;
  raw?: unknown;
}

export interface ReviewCommentLocation {
  file: string;
  line?: number;
}

export interface ReviewComment {
  id: string;
  category: CommentCategory;
  severity: Severity;
  confidence: Confidence;
  message: string;
  locations: ReviewCommentLocation[];
  evidence: EvidenceRef[];
  suggestedFix?: string;
}

export type PlanActionKind =
  | 'gather_context'
  | 'retrieve_knowledge'
  | 'run_ci'
  | 'metamorphic'
  | 'mutation'
  | 'benchmark'
  | 'llm_review'
  | 'llm_filter';

export interface PlanAction {
  id: string;
  kind: PlanActionKind;
  description: string;
  estimatedCost: number;
  params?: Record<string, unknown>;
}

export type BudgetMode = 'quick' | 'standard' | 'deep';

export interface ReviewBudget {
  mode: BudgetMode;
  maxModelCalls: number;
  maxDynamicChecks: number;
  maxComments: number;
  timeoutMs: number;
}

export interface ReviewPlan {
  risk: RiskScore;
  budget: ReviewBudget;
  actions: PlanAction[];
}

export interface KnowledgeContext {
  issues: Array<{
    key: string;
    title?: string;
    acceptanceCriteria?: string[];
    url?: string;
    raw?: unknown;
  }>;
  architectureNotes: Array<{
    title: string;
    excerpt: string;
    source?: string;
  }>;
  northStar: Array<{
    title: string;
    excerpt: string;
    source?: string;
  }>;
  precedent: Array<{
    summary: string;
    url?: string;
    raw?: unknown;
  }>;
}

export interface PullRequestContext {
  meta: PullRequestMetadata;
  baseRef: string;
  headRef: string;
  repoRoot: string;
  diff: Diff;
  riskFeatures: RiskFeatures;
  knowledge: KnowledgeContext;
  artifacts: EvidenceArtifact[];
}

export interface ReviewResult {
  plan: ReviewPlan;
  comments: ReviewComment[];
  artifacts: EvidenceArtifact[];
  summaryMarkdown: string;
}

export type MetamorphicRelation = 'idempotent' | 'trim_invariant' | 'case_invariant';
export type MetamorphicInput = 'string' | 'number';

export interface MetamorphicSpec {
  module: string;
  export: string;
  relation: MetamorphicRelation;
  input?: MetamorphicInput;
  samples?: number;
}

export interface VetraConfig {
  repoRoot?: string;
  commands?: {
    test?: string;
    benchmark?: string;
  };
  checks?: {
    metamorphic?: {
      enabled?: boolean;
      specs?: MetamorphicSpec[];
    };
    mutation?: {
      enabled?: boolean;
      maxMutants?: number;
      includePathPrefixes?: string[];
    };
    benchmark?: {
      enabled?: boolean;
    };
  };
  planner?: {
    sensitivePathPatterns?: string[];
  };
  verifier?: {
    requireEvidenceForHighSeverity?: boolean;
    maxComments?: number;
  };
  knowledge?: {
    issuesJsonPath?: string;
    northStarMarkdownPath?: string;
    architectureMarkdownPath?: string;
  };
}
