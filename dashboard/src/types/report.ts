export type IssueCategory =
  "token_misuse" | "new_pattern_candidate" | "accidental_regression" | "acceptable_exception";

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueStatus = "open";

export interface DriftReport {
  schemaVersion: number;
  runId: string;
  projectName: string;
  createdAt: string;
  configSummary?: ConfigSummary;
  summary: ReportSummary;
  tokens?: TokenMetadata;
  pages?: PageCapture[];
  issues: DriftIssue[];
}

export interface ConfigSummary {
  routes?: number;
  viewports?: number;
  states?: string[];
  tokenFiles?: number;
}

export interface ReportSummary {
  totalIssues: number;
  countsByCategory: Partial<Record<IssueCategory, number>> | Record<string, number>;
  countsBySeverity: Partial<Record<IssueSeverity, number>> | Record<string, number>;
  driftScore: number;
}

export interface TokenMetadata {
  counts?: Record<string, number>;
  sourceFiles?: TokenSourceFile[];
}

export interface TokenSourceFile {
  path: string;
  modifiedTime?: string;
}

export interface PageCapture {
  routeId: string;
  viewport: string;
  state: string;
  screenshotPath?: string;
  capturedAt?: string;
  browser?: {
    name?: string;
    version?: string;
  };
}

export interface DriftIssue {
  id: string;
  title: string;
  category: IssueCategory;
  severity: IssueSeverity;
  confidence: number;
  routeId: string;
  viewport: string;
  state: string;
  elementId: string;
  selectorHint?: string;
  property: string;
  observedValue: string;
  expectedValue?: string;
  nearestToken?: string;
  evidence?: IssueEvidence;
  reasoning: string;
  suggestedFix?: SuggestedFix;
  status: IssueStatus | string;
  aiEnriched?: boolean;
}

export interface IssueEvidence {
  screenshotPath?: string;
  cropBox?: CropBox;
  tokenDistance?: number;
  occurrenceCount?: number;
  relatedIssueIds?: string[];
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SuggestedFix {
  type: string;
  cssBefore?: string;
  cssAfter?: string;
  tsxBefore?: string;
  tsxAfter?: string;
  sourceFile?: string;
  humanInstruction?: string;
}

export type Issue = DriftIssue;
export type ScanReport = DriftReport;
