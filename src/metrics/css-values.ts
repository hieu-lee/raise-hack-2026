export interface ShadowValue {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

const lengthPattern = /-?\d*\.?\d+(?:px|rem|em)?/gi;

export function normalizeCssList(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parsePx(value: string, basePx = 16): number | undefined {
  const match = value.trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/i);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  return match[2]?.toLowerCase() === "rem" || match[2]?.toLowerCase() === "em"
    ? amount * basePx
    : amount;
}

export function extractPxValues(value: string, basePx = 16): number[] {
  return [...value.matchAll(lengthPattern)]
    .map((match) => parsePx(match[0], basePx))
    .filter((px): px is number => px !== undefined);
}

export function normalizeFontFamily(value: string): string {
  return value
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
}

export function parseFontWeight(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "normal") {
    return 400;
  }

  if (normalized === "bold") {
    return 700;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseLineHeight(value: string, fontSizePx?: number): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "normal") {
    return undefined;
  }

  if (/^-?\d*\.?\d+$/.test(normalized)) {
    const unitless = Number(normalized);
    return Number.isFinite(unitless) && fontSizePx !== undefined
      ? unitless * fontSizePx
      : undefined;
  }

  const px = parsePx(normalized);
  if (px !== undefined) {
    return px;
  }

  return undefined;
}

export function parseShadow(value: string): ShadowValue | undefined {
  const normalized = normalizeCssList(firstShadowLayer(value));
  if (!normalized || normalized === "none") {
    return undefined;
  }

  const colorPattern = /(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/gi;
  const colorMatch = normalized.match(colorPattern);
  const lengths = extractPxValues(normalized.replace(colorPattern, " "));
  if (lengths.length < 2) {
    return undefined;
  }

  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: colorMatch?.[0] ?? "rgba(0, 0, 0, 0.25)"
  };
}

export function formatPx(value: number): string {
  return `${Number(value.toFixed(3))}px`;
}

function firstShadowLayer(value: string): string {
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return value.slice(0, index);
    }
  }

  return value;
}
