import type { DriftIssue, ObservationRecord, TokenSet } from "../contracts/types.js";
import { clusterByThreshold } from "../metrics/cluster.js";
import { extractPxValues, formatPx, normalizeFontFamily } from "../metrics/css-values.js";
import {
  colorDistance,
  isTransparentColor,
  nearestToken,
  normalizeColor,
  normalizeShadow,
  normalizeTypography,
  numberDistance,
  shadowDistance,
  typographyDistance,
  type ColorTokenMetric,
  type NumberTokenMetric,
  type ShadowMetric,
  type TypographyMetric
} from "../metrics/distance.js";
import { isContextException } from "./context.js";
import type { AnalysisResult, AnalysisThresholds, NormalizedObservation } from "./types.js";

export const defaultAnalysisThresholds: AnalysisThresholds = {
  color: 0.04,
  spacing: 2,
  radius: 2,
  typography: 2,
  shadow: 4,
  minPatternOccurrences: 3
};

export function analyzeObservations(
  records: ObservationRecord[],
  tokens: TokenSet,
  thresholds: Partial<AnalysisThresholds> = {}
): AnalysisResult {
  const resolvedThresholds = { ...defaultAnalysisThresholds, ...thresholds };
  const tokenMetrics = normalizeTokens(tokens);
  const observations = records.flatMap((record) =>
    normalizeRecord(record, tokenMetrics, resolvedThresholds)
  );

  annotateClusters(observations, resolvedThresholds);

  return {
    observations,
    thresholds: resolvedThresholds
  };
}

function normalizeRecord(
  record: ObservationRecord,
  tokens: NormalizedTokens,
  thresholds: AnalysisThresholds
): NormalizedObservation[] {
  return [
    ...normalizeColorProperties(record, tokens.colors, thresholds),
    ...normalizeNumberProperties(record, tokens, thresholds),
    normalizeTypographyProperty(record, tokens.typography, thresholds),
    normalizeShadowProperty(record, tokens.shadows, thresholds)
  ].filter((observation): observation is NormalizedObservation => observation !== undefined);
}

function normalizeColorProperties(
  record: ObservationRecord,
  tokens: ColorTokenMetric[],
  thresholds: AnalysisThresholds
): NormalizedObservation[] {
  return (["color", "backgroundColor", "borderColor"] as const)
    .map((sourceProperty) => {
      const color = normalizeColor(record.computed[sourceProperty]);
      if (!color) {
        return undefined;
      }

      const nearest = nearestToken(color, tokens, (observed, token) =>
        colorDistance(observed, token.value)
      );

      return buildObservation({
        record,
        property: "color",
        sourceProperty,
        observedValue: `${sourceProperty}: ${color}`,
        comparableValue: color,
        nearestToken:
          nearest && nearest.distance <= thresholds.color
            ? {
                name: nearest.token.name,
                cssVariable: nearest.token.cssVariable,
                value: nearest.token.value,
                distance: nearest.distance
              }
            : undefined,
        tokenDistance: nearest?.distance,
        tokenThreshold: thresholds.color,
        exactToken: nearest !== undefined && nearest.distance <= 0.002
      });
    })
    .filter((observation): observation is NormalizedObservation => observation !== undefined);
}

function normalizeNumberProperties(
  record: ObservationRecord,
  tokens: NormalizedTokens,
  thresholds: AnalysisThresholds
): NormalizedObservation[] {
  const observations: NormalizedObservation[] = [];

  for (const sourceProperty of ["margin", "padding", "gap"] as const) {
    for (const px of uniqueNumbers(extractPxValues(record.computed[sourceProperty]))) {
      observations.push(
        numberObservation(record, "spacing", sourceProperty, px, tokens.spacing, thresholds.spacing)
      );
    }
  }

  for (const px of uniqueNumbers(extractPxValues(record.computed.borderRadius))) {
    observations.push(
      numberObservation(record, "radius", "borderRadius", px, tokens.radii, thresholds.radius)
    );
  }

  if (record.boundingBox.height > 0) {
    observations.push(
      numberObservation(
        record,
        "component-pattern",
        "height",
        record.boundingBox.height,
        tokens.spacing,
        thresholds.spacing
      )
    );
  }

  return observations;
}

function numberObservation(
  record: ObservationRecord,
  property: DriftIssue["property"],
  sourceProperty: string,
  px: number,
  tokens: NumberTokenMetric[],
  tokenThreshold: number
): NormalizedObservation {
  const nearest = nearestToken(px, tokens, (observed, token) => numberDistance(observed, token.px));

  return buildObservation({
    record,
    property,
    sourceProperty,
    observedValue: `${sourceProperty}: ${formatPx(px)}`,
    comparableValue: px,
    nearestToken:
      nearest && nearest.distance <= tokenThreshold
        ? {
            name: nearest.token.name,
            cssVariable: nearest.token.cssVariable,
            value: formatPx(nearest.token.px),
            distance: nearest.distance
          }
        : undefined,
    tokenDistance: nearest?.distance,
    tokenThreshold,
    exactToken: nearest !== undefined && nearest.distance <= 0.1
  });
}

function normalizeTypographyProperty(
  record: ObservationRecord,
  tokens: TypographyMetric[],
  thresholds: AnalysisThresholds
): NormalizedObservation | undefined {
  const typography = normalizeTypography(record.computed);
  const nearest = nearestToken(typography, tokens, typographyDistance);

  if (!typography.family && typography.size === undefined && typography.weight === undefined) {
    return undefined;
  }

  return buildObservation({
    record,
    property: "typography",
    sourceProperty: "typography",
    observedValue: typographyLabel(typography),
    comparableValue: typography,
    nearestToken:
      nearest && nearest.distance <= thresholds.typography
        ? {
            name: typographyLabel(nearest.token),
            value: typographyLabel(nearest.token),
            distance: nearest.distance
          }
        : undefined,
    tokenDistance: nearest?.distance,
    tokenThreshold: thresholds.typography,
    exactToken: nearest !== undefined && nearest.distance <= 0.1
  });
}

function normalizeShadowProperty(
  record: ObservationRecord,
  tokens: ShadowMetric[],
  thresholds: AnalysisThresholds
): NormalizedObservation | undefined {
  const shadow = normalizeShadow(record.computed.boxShadow);
  if (!shadow) {
    return undefined;
  }

  const nearest = nearestToken(shadow, tokens, shadowDistance);

  return buildObservation({
    record,
    property: "shadow",
    sourceProperty: "boxShadow",
    observedValue: `boxShadow: ${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`,
    comparableValue: shadow,
    nearestToken:
      nearest && nearest.distance <= thresholds.shadow
        ? {
            name: nearest.token.name ?? "shadow-token",
            cssVariable: nearest.token.cssVariable,
            value: `${nearest.token.offsetX}px ${nearest.token.offsetY}px ${nearest.token.blur}px ${nearest.token.spread}px ${nearest.token.color}`,
            distance: nearest.distance
          }
        : undefined,
    tokenDistance: nearest?.distance,
    tokenThreshold: thresholds.shadow,
    exactToken: nearest !== undefined && nearest.distance <= 0.2
  });
}

function buildObservation(
  input: Omit<NormalizedObservation, "occurrenceCount">
): NormalizedObservation {
  return {
    ...input,
    occurrenceCount: 1
  };
}

function annotateClusters(
  observations: NormalizedObservation[],
  thresholds: AnalysisThresholds
): void {
  const untokenized = observations.filter(
    (observation) =>
      !observation.nearestToken &&
      !observation.exactToken &&
      !isContextException(observation.record)
  );
  const groups = groupBy(
    untokenized,
    (observation) => `${observation.property}:${observation.sourceProperty}`
  );

  for (const [groupKey, groupObservations] of groups) {
    const clusters = clusterByThreshold(
      groupObservations,
      clusterThreshold(groupObservations[0]?.property, thresholds),
      observationDistance,
      (seed, index) => `${groupKey}:${index}:${String(seed.comparableValue)}`
    );

    for (const cluster of clusters) {
      if (cluster.items.length < thresholds.minPatternOccurrences) {
        continue;
      }

      for (const item of cluster.items) {
        item.clusterId = cluster.id;
        item.occurrenceCount = cluster.items.length;
      }
    }
  }
}

function observationDistance(first: NormalizedObservation, second: NormalizedObservation): number {
  if (typeof first.comparableValue === "number" && typeof second.comparableValue === "number") {
    return numberDistance(first.comparableValue, second.comparableValue);
  }

  if (typeof first.comparableValue === "string" && typeof second.comparableValue === "string") {
    return colorDistance(first.comparableValue, second.comparableValue);
  }

  if (first.property === "typography") {
    return typographyDistance(
      first.comparableValue as TypographyMetric,
      second.comparableValue as TypographyMetric
    );
  }

  if (first.property === "shadow") {
    return shadowDistance(
      first.comparableValue as ShadowMetric,
      second.comparableValue as ShadowMetric
    );
  }

  return first.observedValue === second.observedValue ? 0 : Number.POSITIVE_INFINITY;
}

function clusterThreshold(
  property: DriftIssue["property"] | undefined,
  thresholds: AnalysisThresholds
): number {
  if (property === "color") {
    return thresholds.color;
  }

  if (property === "radius") {
    return thresholds.radius;
  }

  if (property === "typography") {
    return thresholds.typography;
  }

  if (property === "shadow") {
    return thresholds.shadow;
  }

  return thresholds.spacing;
}

function normalizeTokens(tokens: TokenSet): NormalizedTokens {
  return {
    colors: tokens.colors.flatMap((token) => {
      const value =
        normalizeColor(token.originalValue) ??
        (isTransparentColor(token.originalValue) ? undefined : normalizeColor(token.hex));
      return value ? [{ name: token.name, cssVariable: token.cssVariable, value }] : [];
    }),
    spacing: tokens.spacing.map((token) => ({
      name: token.name,
      cssVariable: token.cssVariable,
      px: token.px
    })),
    radii: tokens.radii.map((token) => ({
      name: token.name,
      cssVariable: token.cssVariable,
      px: token.px
    })),
    typography: tokens.typography.map((token) => ({
      family: token.family === undefined ? undefined : normalizeFontFamily(token.family),
      size: token.size,
      lineHeight: token.lineHeight,
      weight: token.weight,
      letterSpacing: token.letterSpacing
    })),
    shadows: tokens.shadows.map((token, index) => ({
      name: `shadow-${index + 1}`,
      offsetX: token.offsetX,
      offsetY: token.offsetY,
      blur: token.blur,
      spread: token.spread,
      color: normalizeColor(token.color) ?? token.color
    }))
  };
}

function typographyLabel(typography: TypographyMetric): string {
  return [
    typography.family,
    typography.size === undefined ? undefined : `${typography.size}px`,
    typography.lineHeight === undefined ? undefined : `${typography.lineHeight}px`,
    typography.weight,
    typography.letterSpacing === undefined ? undefined : `${typography.letterSpacing}px`
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

interface NormalizedTokens {
  colors: ColorTokenMetric[];
  spacing: NumberTokenMetric[];
  radii: NumberTokenMetric[];
  typography: TypographyMetric[];
  shadows: ShadowMetric[];
}
