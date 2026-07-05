import { converter, differenceEuclidean, formatHex, parse } from "culori";
import {
  normalizeFontFamily,
  parseFontWeight,
  parseLineHeight,
  parsePx,
  parseShadow,
  type ShadowValue
} from "./css-values.js";

export interface ColorTokenMetric {
  name: string;
  cssVariable?: string;
  value: string;
}

export interface NumberTokenMetric {
  name: string;
  cssVariable?: string;
  px: number;
}

export interface TypographyMetric {
  family?: string;
  size?: number;
  lineHeight?: number;
  weight?: number;
  letterSpacing?: number;
}

export interface ShadowMetric extends ShadowValue {
  name?: string;
  cssVariable?: string;
}

export interface NearestToken<T> {
  token: T;
  distance: number;
}

const toRgb = converter("rgb");
const colorDifference = differenceEuclidean("oklch");

export function normalizeColor(value: string): string | undefined {
  const parsed = parse(value);
  if (!parsed || parsed.alpha === 0) {
    return undefined;
  }

  const rgb = toRgb(value);
  if (!rgb) {
    return undefined;
  }

  const alpha = typeof rgb.alpha === "number" ? rgb.alpha : 1;
  if (alpha < 1) {
    return `rgba(${rgbChannel(rgb.r)}, ${rgbChannel(rgb.g)}, ${rgbChannel(rgb.b)}, ${Number(
      alpha.toFixed(3)
    )})`;
  }

  return formatHex(rgb)?.toLowerCase();
}

export function isTransparentColor(value: string): boolean {
  return parse(value)?.alpha === 0;
}

export function colorDistance(first: string, second: string): number {
  const firstColor = parse(first);
  const secondColor = parse(second);
  if (!firstColor || !secondColor) {
    return Number.POSITIVE_INFINITY;
  }

  const alphaDistance = Math.abs(alphaOf(firstColor.alpha) - alphaOf(secondColor.alpha)) * 0.2;
  return colorDifference(first, second) + alphaDistance;
}

export function numberDistance(first: number, second: number): number {
  return Math.abs(first - second);
}

export function normalizeTypography(input: {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
}): TypographyMetric {
  const size = parsePx(input.fontSize);

  return {
    family: normalizeFontFamily(input.fontFamily),
    size,
    lineHeight: parseLineHeight(input.lineHeight, size),
    weight: parseFontWeight(input.fontWeight),
    letterSpacing: parsePx(input.letterSpacing) ?? 0
  };
}

export function typographyDistance(first: TypographyMetric, second: TypographyMetric): number {
  let distance = 0;

  if (first.family && second.family && first.family !== second.family) {
    distance += 4;
  }

  distance +=
    first.size !== undefined && second.size !== undefined ? Math.abs(first.size - second.size) : 0;
  distance +=
    first.lineHeight !== undefined && second.lineHeight !== undefined
      ? Math.abs(first.lineHeight - second.lineHeight) * 0.5
      : 0;
  distance +=
    first.weight !== undefined && second.weight !== undefined
      ? Math.abs(first.weight - second.weight) / 100
      : 0;
  distance +=
    first.letterSpacing !== undefined && second.letterSpacing !== undefined
      ? Math.abs(first.letterSpacing - second.letterSpacing)
      : 0;

  return distance;
}

export function normalizeShadow(value: string): ShadowValue | undefined {
  const shadow = parseShadow(value);
  if (!shadow) {
    return undefined;
  }

  return {
    ...shadow,
    color: normalizeColor(shadow.color) ?? shadow.color
  };
}

export function shadowDistance(first: ShadowValue, second: ShadowValue): number {
  return (
    Math.abs(first.offsetX - second.offsetX) +
    Math.abs(first.offsetY - second.offsetY) +
    Math.abs(first.blur - second.blur) * 0.5 +
    Math.abs(first.spread - second.spread) +
    colorDistance(first.color, second.color) * 40
  );
}

function rgbChannel(value: number | string | undefined): number {
  return Math.round(Number(value ?? 0) * 255);
}

function alphaOf(value: unknown): number {
  return typeof value === "number" ? value : 1;
}

export function nearestToken<Observed, Token>(
  observed: Observed,
  tokens: Token[],
  distance: (observed: Observed, token: Token) => number
): NearestToken<Token> | undefined {
  let nearest: NearestToken<Token> | undefined;

  for (const token of tokens) {
    const tokenDistance = distance(observed, token);
    if (!nearest || tokenDistance < nearest.distance) {
      nearest = { token, distance: tokenDistance };
    }
  }

  return nearest;
}
