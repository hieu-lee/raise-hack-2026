import type { DriftIssue, ObservationRecord } from "../contracts/types.js";
import type { ShadowValue } from "../metrics/css-values.js";
import type { TypographyMetric } from "../metrics/distance.js";

export interface AnalysisThresholds {
  color: number;
  spacing: number;
  radius: number;
  typography: number;
  shadow: number;
  minPatternOccurrences: number;
}

export interface TokenMatch {
  name: string;
  cssVariable?: string;
  value: string;
  distance: number;
}

export type ComparableValue = string | number | TypographyMetric | ShadowValue;

export interface NormalizedObservation {
  record: ObservationRecord;
  property: DriftIssue["property"];
  sourceProperty: string;
  observedValue: string;
  comparableValue: ComparableValue;
  nearestToken?: TokenMatch;
  tokenDistance?: number;
  tokenThreshold: number;
  exactToken: boolean;
  clusterId?: string;
  occurrenceCount: number;
}

export interface AnalysisResult {
  observations: NormalizedObservation[];
  thresholds: AnalysisThresholds;
}
