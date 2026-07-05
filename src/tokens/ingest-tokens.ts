import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { converter, formatHex, formatHex8, parse as parseColorValue } from "culori";
import safeParse from "postcss-safe-parser";
import type { AtRule, Declaration, Rule } from "postcss";
import type { TokenSet } from "../contracts/types.js";

type TokenInput = {
  name: string;
  cssVariable?: string;
  originalValue: string;
  rawValueKind?: string;
  resolvedValue?: string;
  sourcePath?: string;
  type?: string;
};

type TypographyToken = TokenSet["typography"][number];
type ShadowParts = Omit<TokenSet["shadows"][number], "name" | "cssVariable" | "originalValue">;
type AliasValues = {
  names: Map<string, string>;
  cssVariables: Map<string, string>;
};
type AliasTarget = {
  id: string;
  value?: string;
  fallback?: string;
};

const toOklch = converter("oklch");
const tokenKeys = new Set(["$value", "value"]);
const aliasPattern = /^\{[a-zA-Z0-9_.-]+\}$/;
const cssVarAliasPattern = /^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*(.+))?\s*\)$/;
const cssVarFunctionPattern = /var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*([^)]+))?\s*\)/g;

export class TokenIngestionError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid token files:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  }
}

export async function ingestTokenFiles(paths: string[]): Promise<TokenSet> {
  const errors: string[] = [];
  const tokens: TokenSet = {
    sourceFiles: [],
    colors: [],
    spacing: [],
    radii: [],
    typography: [],
    shadows: []
  };
  const colors = new Map<string, TokenSet["colors"][number]>();
  const spacing = new Map<string, TokenSet["spacing"][number]>();
  const radii = new Map<string, TokenSet["radii"][number]>();
  const typography = new Map<string, TypographyToken>();
  const shadows = new Map<string, TokenSet["shadows"][number]>();
  const parsedInputs: TokenInput[] = [];

  for (const path of paths) {
    const absolutePath = resolve(path);
    let raw: string;

    try {
      const fileStat = await stat(absolutePath);
      raw = await readFile(absolutePath, "utf8");
      tokens.sourceFiles.push({
        path,
        modifiedTime: fileStat.mtime.toISOString()
      });
    } catch (error) {
      errors.push(`${path}: ${messageOf(error)}`);
      continue;
    }

    const extension = extname(path).toLowerCase();
    const inputs =
      extension === ".css"
        ? parseCssTokens(path, raw)
        : extension === ".json"
          ? parseJsonTokens(path, raw, errors)
          : [];

    if (inputs.length === 0) {
      errors.push(`${path}: no tokens found`);
    }

    parsedInputs.push(...inputs.map((input) => ({ ...input, sourcePath: path })));
  }

  const effectiveInputs = finalTokenInputs(parsedInputs);
  const aliasValues = aliasValueMaps(effectiveInputs);
  const recognizableInputs = parsedInputs.filter(
    (input) =>
      !isSkippableTokenInput(input) &&
      isPotentialTokenInput(resolveAliases(input, aliasValues, []), aliasValues)
  );
  const recognizableSources = new Set(
    [
      ...recognizableInputs.map((input) => input.sourcePath),
      ...referencedCssVariableSources(recognizableInputs, parsedInputs)
    ].filter((sourcePath): sourcePath is string => Boolean(sourcePath))
  );
  for (const sourcePath of new Set(parsedInputs.map((input) => input.sourcePath))) {
    if (sourcePath && !recognizableSources.has(sourcePath)) {
      errors.push(`${sourcePath}: No recognizable tokens found`);
    }
  }

  for (const input of effectiveInputs) {
    if (isSkippableTokenInput(input)) {
      continue;
    }
    addToken(
      resolveAliases(input, aliasValues, errors),
      { colors, spacing, radii, typography, shadows },
      errors,
      aliasValues
    );
  }

  const normalizedTokens: TokenSet = {
    sourceFiles: tokens.sourceFiles,
    colors: [...colors.values()],
    spacing: [...spacing.values()],
    radii: [...radii.values()],
    typography: [...typography.values()].map((token) => stripUndefined(token)),
    shadows: [...shadows.values()]
  };
  const normalizedCount =
    normalizedTokens.colors.length +
    normalizedTokens.spacing.length +
    normalizedTokens.radii.length +
    normalizedTokens.typography.length +
    normalizedTokens.shadows.length;
  if (normalizedCount === 0) {
    errors.push("No recognizable tokens found");
  }

  if (errors.length > 0) {
    throw new TokenIngestionError(errors);
  }

  return normalizedTokens;
}

function finalTokenInputs(inputs: TokenInput[]): TokenInput[] {
  const byKey = new Map<string, TokenInput>();
  for (const input of inputs) {
    byKey.set(`${input.cssVariable ?? ""}:${input.name}`, input);
  }
  return [...byKey.values()];
}

function aliasValueMaps(inputs: TokenInput[]): AliasValues {
  const names = new Map<string, string>();
  const cssVariables = new Map<string, string>();
  for (const input of inputs) {
    names.set(input.name, input.originalValue);
    if (input.cssVariable) {
      cssVariables.set(
        cssVariableKey(input.cssVariable, input.name.startsWith("dark.")),
        input.originalValue
      );
    }
  }
  return { names, cssVariables };
}

function referencedCssVariableSources(
  recognizableInputs: TokenInput[],
  allInputs: TokenInput[]
): Set<string | undefined> {
  const byCssVariable = new Map<string, TokenInput[]>();
  for (const input of allInputs) {
    if (!input.cssVariable) {
      continue;
    }
    const existing = byCssVariable.get(input.cssVariable) ?? [];
    existing.push(input);
    byCssVariable.set(input.cssVariable, existing);
  }

  const sources = new Set<string | undefined>();
  const seenVariables = new Set<string>();
  const pending = recognizableInputs.flatMap((input) => cssVariableReferences(input.originalValue));
  while (pending.length > 0) {
    const cssVariable = pending.pop();
    if (!cssVariable || seenVariables.has(cssVariable)) {
      continue;
    }
    seenVariables.add(cssVariable);
    for (const provider of byCssVariable.get(cssVariable) ?? []) {
      sources.add(provider.sourcePath);
      pending.push(...cssVariableReferences(provider.originalValue));
    }
  }
  return sources;
}

function cssVariableReferences(value: string): string[] {
  return [...value.matchAll(cssVarFunctionPattern)]
    .map((match) => match[1])
    .filter((cssVariable): cssVariable is string => Boolean(cssVariable));
}

function parseCssTokens(path: string, raw: string): TokenInput[] {
  const root = safeParse(raw, { from: path });
  const tokens: TokenInput[] = [];

  root.walkDecls(/^--/, (declaration) => {
    const scopes = cssTokenScopes(declaration);
    if (scopes.length === 0) {
      return;
    }

    const name = declaration.prop.slice(2);
    scopes.forEach((scope) => {
      tokens.push({
        name: scope === "dark" ? `dark.${name}` : name,
        cssVariable: declaration.prop,
        originalValue: declaration.value.trim()
      });
    });
  });

  return tokens;
}

function parseJsonTokens(path: string, raw: string, errors: string[]): TokenInput[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isPlainObject(value)) {
      errors.push(`${path}: expected a JSON token object`);
      return [];
    }

    const tokens: TokenInput[] = [];
    visitJsonToken(value, [], undefined, tokens);
    if (tokens.some((token) => token.name === "")) {
      errors.push(`${path}: token names must not be empty`);
    }
    return tokens.filter((token) => token.name !== "");
  } catch (error) {
    errors.push(`${path}: invalid JSON (${messageOf(error)})`);
    return [];
  }
}

function visitJsonToken(
  value: unknown,
  path: string[],
  inheritedType: string | undefined,
  tokens: TokenInput[]
): void {
  if (isPlainObject(value)) {
    const localType = stringValue(value.$type ?? value.type) ?? inheritedType;
    const raw = "$value" in value ? value.$value : value.value;

    if (hasTokenValue(value)) {
      tokens.push({
        name: path.join("."),
        originalValue: stringifyTokenValue(raw),
        rawValueKind: typeof raw,
        type: localType
      });
      return;
    }

    if (path.length > 0 && isCompositeTokenObject(value)) {
      tokens.push({
        name: path.join("."),
        originalValue: stringifyTokenValue(value),
        type: localType
      });
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("$") || key === "type") {
        continue;
      }

      visitJsonToken(child, [...path, key], localType, tokens);
    }

    return;
  }

  if (path.length > 0) {
    tokens.push({
      name: path.join("."),
      originalValue: stringifyTokenValue(value),
      rawValueKind: typeof value
    });
  }
}

// ponytail: CSS-wide keywords and Tailwind v4 namespace resets (`--font-*: initial`) are not
// design tokens, just meta declarations. Skipping them beats trying to classify/parse them.
const nonTokenKeywords = new Set([
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
  "currentcolor"
]);

function isSkippableTokenValue(name: string, value: string): boolean {
  return name.includes("*") || nonTokenKeywords.has(value.trim().toLowerCase());
}

function isSkippableTokenInput(input: TokenInput): boolean {
  return (
    isSkippableTokenValue(input.name.toLowerCase(), input.originalValue) ||
    isSelfCssVariableAlias(input)
  );
}

function isSelfCssVariableAlias(input: TokenInput): boolean {
  if (!input.cssVariable) {
    return false;
  }
  const match = input.originalValue.trim().match(cssVarAliasPattern);
  return match?.[1] === input.cssVariable && match[2] === undefined;
}

function addToken(
  input: TokenInput,
  maps: {
    colors: Map<string, TokenSet["colors"][number]>;
    spacing: Map<string, TokenSet["spacing"][number]>;
    radii: Map<string, TokenSet["radii"][number]>;
    typography: Map<string, TypographyToken>;
    shadows: Map<string, TokenSet["shadows"][number]>;
  },
  errors: string[],
  aliasValues: AliasValues
): void {
  const type = input.type?.toLowerCase();
  const name = input.name.toLowerCase();
  const value = (input.resolvedValue ?? input.originalValue).trim();
  const key = `${input.cssVariable ?? ""}:${input.name}`;

  if (isSkippableTokenValue(name, value)) {
    return;
  }
  const directColor = normalizeColor(value, aliasValues, input.name);
  const parsedValue = tryParseJson(value);
  const isShadowObject = isPlainObject(parsedValue) && isShadowCompositeObject(parsedValue);

  if (type?.includes("color")) {
    if (!directColor) {
      errors.push(tokenIssue(input, `${input.name}: expected a color token, got ${value}`));
      return;
    }

    maps.colors.set(key, {
      ...tokenMetadata(input),
      oklch: directColor.oklch,
      hex: directColor.hex
    });
    return;
  }

  if (
    tokenNameMatches(name, ["color"]) ||
    (directColor && tokenNameMatches(name, ["background"]))
  ) {
    if (!directColor) {
      errors.push(tokenIssue(input, `${input.name}: expected a color token, got ${value}`));
      return;
    }

    maps.colors.set(key, {
      ...tokenMetadata(input),
      oklch: directColor.oklch,
      hex: directColor.hex
    });
    return;
  }

  if (isTypographyToken(type, name, value)) {
    addTypography(input, maps.typography, errors, aliasValues);
    return;
  }

  if (
    type?.includes("shadow") ||
    tokenNameMatches(name, ["shadow", "elevation"]) ||
    isShadowObject
  ) {
    const shadow = normalizeShadow(value, aliasValues, errors, input.name);
    if (!shadow) {
      errors.push(tokenIssue(input, `${input.name}: expected a shadow token, got ${value}`));
      return;
    }

    maps.shadows.set(key, { ...tokenMetadata(input), ...shadow });
    return;
  }

  if (type?.includes("radius") || tokenNameMatches(name, ["radius", "radii", "rounded"])) {
    const px = parsePx(value);
    if (px === undefined || px < 0) {
      errors.push(tokenIssue(input, `${input.name}: expected a radius length, got ${value}`));
      return;
    }

    maps.radii.set(key, { ...tokenMetadata(input), px });
    return;
  }

  if (
    type?.includes("dimension") ||
    tokenNameMatches(name, ["space", "spacing", "gap", "margin", "padding"])
  ) {
    const px = parsePx(value);
    if (px === undefined || px < 0) {
      errors.push(tokenIssue(input, `${input.name}: expected a spacing length, got ${value}`));
      return;
    }

    maps.spacing.set(key, { ...tokenMetadata(input), px });
    return;
  }

  const color = directColor;
  if (color || tokenNameMatches(name, ["color", "background"])) {
    if (!color) {
      errors.push(tokenIssue(input, `${input.name}: expected a color token, got ${value}`));
      return;
    }

    maps.colors.set(key, { ...tokenMetadata(input), oklch: color.oklch, hex: color.hex });
  }
}

function tokenIssue(input: TokenInput, issue: string): string {
  return input.sourcePath ? `${input.sourcePath}: ${issue}` : issue;
}

function isPotentialTokenInput(
  input: TokenInput,
  aliasValues: AliasValues = emptyAliasValues()
): boolean {
  const type = input.type?.toLowerCase();
  const name = input.name.toLowerCase();
  const value = (input.resolvedValue ?? input.originalValue).trim();
  if (isSkippableTokenValue(name, value)) {
    return false;
  }
  const directColor = normalizeColor(value, aliasValues, input.name);
  const parsedValue = tryParseJson(value);
  const isShadowObject = isPlainObject(parsedValue) && isShadowCompositeObject(parsedValue);

  return Boolean(
    type?.includes("color") ||
    tokenNameMatches(name, ["color", "background"]) ||
    directColor ||
    isTypographyToken(type, name, value) ||
    type?.includes("shadow") ||
    tokenNameMatches(name, ["shadow", "elevation"]) ||
    isShadowObject ||
    type?.includes("radius") ||
    tokenNameMatches(name, ["radius", "radii", "rounded"]) ||
    type?.includes("dimension") ||
    tokenNameMatches(name, ["space", "spacing", "gap", "margin", "padding"])
  );
}

function addTypography(
  input: TokenInput,
  typography: Map<string, TypographyToken>,
  errors: string[],
  aliasValues: AliasValues
): void {
  const resolvedValue = input.resolvedValue ?? input.originalValue;
  const value = tryParseJson(resolvedValue);
  const type = input.type?.toLowerCase();
  const compactName = compactTokenName(input.name);
  const base = tokenMetadata(input);

  if (isPlainObject(value)) {
    const family = resolveFieldAlias(
      objectField(value, "fontFamily", "family"),
      aliasValues,
      errors,
      input,
      "fontFamily"
    );
    const fontSize = resolveFieldAlias(
      objectField(value, "fontSize", "size"),
      aliasValues,
      errors,
      input,
      "fontSize"
    );
    const lineHeight = resolveFieldAlias(
      value.lineHeight,
      aliasValues,
      errors,
      input,
      "lineHeight"
    );
    const fontWeight = resolveFieldAlias(
      objectField(value, "fontWeight", "weight"),
      aliasValues,
      errors,
      input,
      "fontWeight"
    );
    const letterSpacing = resolveFieldAlias(
      value.letterSpacing,
      aliasValues,
      errors,
      input,
      "letterSpacing"
    );
    const parsed = {
      family: stringValue(family),
      size: parseOptionalPx(fontSize),
      lineHeight: parseOptionalLineHeight(lineHeight),
      weight: parseOptionalWeight(fontWeight),
      letterSpacing: parseOptionalPx(letterSpacing)
    };
    const hasKnownField =
      family !== undefined ||
      fontSize !== undefined ||
      lineHeight !== undefined ||
      fontWeight !== undefined ||
      letterSpacing !== undefined;
    let invalid = false;

    if (!hasKnownField) {
      errors.push(tokenIssue(input, `${input.name}: expected at least one typography field`));
      return;
    }

    if (family !== undefined && parsed.family === undefined) {
      errors.push(
        tokenIssue(
          input,
          `${input.name}.fontFamily: expected a font family string, got ${stringifyTokenValue(family)}`
        )
      );
      invalid = true;
    }

    for (const [field, raw, parsedValue, expected, invalidNumber] of [
      [
        "fontSize",
        fontSize,
        parsed.size,
        "a typography length",
        parsed.size !== undefined && parsed.size < 0
      ],
      [
        "lineHeight",
        lineHeight,
        parsed.lineHeight,
        "a line-height token",
        parsed.lineHeight !== undefined && parsed.lineHeight < 0
      ],
      [
        "fontWeight",
        fontWeight,
        parsed.weight,
        "a font weight",
        parsed.weight !== undefined && parsed.weight <= 0
      ],
      ["letterSpacing", letterSpacing, parsed.letterSpacing, "a typography length", false]
    ] as const) {
      if (raw !== undefined && (parsedValue === undefined || invalidNumber)) {
        errors.push(
          tokenIssue(
            input,
            `${input.name}.${field}: expected ${expected}, got ${stringifyTokenValue(raw)}`
          )
        );
        invalid = true;
      }
    }

    if (invalid) {
      return;
    }

    typography.set(input.name, {
      ...base,
      ...parsed
    });
    return;
  }

  if (
    type?.includes("fontfamily") ||
    compactName.includes("family") ||
    looksLikeFontFamilyValue(resolvedValue)
  ) {
    if (input.rawValueKind && input.rawValueKind !== "string") {
      errors.push(
        tokenIssue(
          input,
          `${input.name}: expected a font family string, got ${input.originalValue}`
        )
      );
      return;
    }

    typography.set(input.name, { ...base, family: stripQuotes(resolvedValue) });
    return;
  }

  if (type?.includes("fontweight") || compactName.includes("weight")) {
    const weight = parseOptionalWeight(resolvedValue);
    if (weight === undefined || weight <= 0) {
      errors.push(tokenIssue(input, `${input.name}: expected a font weight, got ${resolvedValue}`));
      return;
    }

    typography.set(input.name, { ...base, weight });
    return;
  }

  if (type?.includes("lineheight") || compactName.includes("lineheight")) {
    const lineHeight = parseOptionalLineHeight(resolvedValue);
    if (lineHeight === undefined || lineHeight < 0) {
      errors.push(
        tokenIssue(input, `${input.name}: expected a line-height token, got ${resolvedValue}`)
      );
      return;
    }

    typography.set(input.name, { ...base, lineHeight });
    return;
  }

  const size = parseOptionalPx(resolvedValue);
  const isLetterSpacing = type?.includes("letterspacing") || compactName.includes("letterspacing");
  if (size === undefined || (!isLetterSpacing && size < 0)) {
    errors.push(
      tokenIssue(input, `${input.name}: expected a typography length, got ${resolvedValue}`)
    );
    return;
  }

  typography.set(
    input.name,
    isLetterSpacing ? { ...base, letterSpacing: size } : { ...base, size }
  );
}

function cssTokenScopes(declaration: Declaration): ("default" | "dark")[] {
  const rule = declaration.parent;
  if (!rule) {
    return [];
  }

  // Tailwind CSS v4 declares design tokens inside `@theme { ... }` instead of `:root { ... }`.
  if (rule.type === "atrule" && (rule as AtRule).name === "theme") {
    return ["default"];
  }

  if (rule.type !== "rule" || !isTokenSelector(rule as Rule)) {
    return [];
  }

  const selectors = (rule as Rule).selector.split(",").map((selector) => selector.trim());
  if (hasDarkMedia(declaration)) {
    return selectors.includes(":root") || selectors.some(isDarkSelector) ? ["dark"] : [];
  }

  const scopes = new Set<"default" | "dark">();
  if (selectors.includes(":root")) {
    scopes.add("default");
  }
  if (selectors.some(isDarkSelector)) {
    scopes.add("dark");
  }

  return [...scopes];
}

function isTokenSelector(rule: Rule): boolean {
  return rule.selector
    .split(",")
    .map((selector) => selector.trim())
    .some((selector) => selector === ":root" || isDarkSelector(selector));
}

function isDarkSelector(selector: string): boolean {
  return selector
    .split(",")
    .map((part) => part.trim())
    .some(
      (part) =>
        /^(?:(?:html|body|:root))?\.dark$/.test(part) ||
        /^(?:(?:html|body|:root))?\[data-theme\s*=\s*(['"]?)dark\1\]$/.test(part)
    );
}

function hasDarkMedia(declaration: Declaration): boolean {
  let parent = declaration.parent?.parent;
  while (parent) {
    if (
      parent.type === "atrule" &&
      parent.name === "media" &&
      /prefers-color-scheme\s*:\s*dark/.test(parent.params)
    ) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

function normalizeColor(
  value: string,
  aliasValues = emptyAliasValues(),
  tokenName = ""
): { oklch: string; hex: string } | undefined {
  const color =
    parseColorValue(value) ??
    parseColorValue(resolveCssVarFunctions(value, aliasValues, tokenName));
  if (!color) {
    return undefined;
  }

  const oklch = toOklch(color);
  const hex =
    typeof color.alpha === "number" && color.alpha < 1 ? formatHex8(color) : formatHex(color);
  if (!oklch || !hex) {
    return undefined;
  }

  const alpha =
    typeof color.alpha === "number" && color.alpha < 1 ? ` / ${roundNumber(color.alpha)}` : "";
  return {
    oklch: `oklch(${roundNumber(oklch.l)} ${roundNumber(oklch.c)} ${roundNumber(oklch.h ?? 0)}${alpha})`,
    hex: hex.toLowerCase()
  };
}

function resolveCssVarFunctions(
  value: string,
  aliasValues: AliasValues,
  tokenName: string
): string {
  let current = value;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const next = current.replace(
      cssVarFunctionPattern,
      (match, cssVariable: string, fallback: string) => {
        const target = aliasTarget(
          fallback === undefined ? `var(${cssVariable})` : `var(${cssVariable}, ${fallback})`,
          tokenName,
          aliasValues
        );
        return target?.value ?? target?.fallback ?? match;
      }
    );
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

function normalizeShadow(
  rawValue: string,
  aliasValues?: AliasValues,
  errors?: string[],
  tokenName?: string
): ShadowParts | undefined {
  const parsed = tryParseJson(rawValue);
  if (isPlainObject(parsed)) {
    return normalizeShadowObject(parsed, aliasValues, errors, tokenName);
  }

  // ponytail: multi-layer box-shadow (comma-separated layers) isn't representable by our
  // single-layer shadow contract yet. Normalize the first layer only; upgrade path is to make
  // TokenSet.shadows[].layers an array if multi-layer tokens become common in real projects.
  const [firstLayer] = splitTopLevelCommas(rawValue);
  const value = firstLayer ?? rawValue;

  const parts = splitCssValue(value)
    .filter((part) => part !== "inset")
    .map((part) =>
      resolveFieldAlias(
        part,
        aliasValues ?? emptyAliasValues(),
        errors ?? [],
        tokenName ?? "shadow",
        "color"
      )
    )
    .map((part) => (typeof part === "string" ? part : stringifyTokenValue(part)));
  const colorIndex = parts.findIndex((part) => normalizeColor(part, aliasValues, tokenName));
  const color =
    colorIndex >= 0 ? normalizeColor(parts[colorIndex], aliasValues, tokenName) : undefined;
  const lengths = parts.filter((_, index) => index !== colorIndex).map((part) => parsePx(part));

  if (
    !color ||
    lengths.length < 2 ||
    lengths.length > 4 ||
    lengths.some((length) => length === undefined) ||
    (lengths[2] ?? 0) < 0
  ) {
    return undefined;
  }

  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: color.hex
  };
}

function normalizeShadowObject(
  value: Record<string, unknown>,
  aliasValues = emptyAliasValues(),
  errors: string[] = [],
  tokenName = "shadow"
): ShadowParts | undefined {
  const colorValue = stringValue(
    resolveFieldAlias(value.color, aliasValues, errors, tokenName, "color")
  );
  const color = colorValue ? normalizeColor(colorValue, aliasValues, tokenName) : undefined;
  const offsetX = parsePx(
    resolveFieldAlias(objectField(value, "offsetX", "x"), aliasValues, errors, tokenName, "offsetX")
  );
  const offsetY = parsePx(
    resolveFieldAlias(objectField(value, "offsetY", "y"), aliasValues, errors, tokenName, "offsetY")
  );
  const blur = parsePx(resolveFieldAlias(value.blur, aliasValues, errors, tokenName, "blur"));
  const spread = parsePx(
    resolveFieldAlias(
      "spread" in value ? value.spread : 0,
      aliasValues,
      errors,
      tokenName,
      "spread"
    )
  );

  if (
    !color ||
    offsetX === undefined ||
    offsetY === undefined ||
    blur === undefined ||
    blur < 0 ||
    spread === undefined
  ) {
    return undefined;
  }

  return {
    offsetX,
    offsetY,
    blur,
    spread,
    color: color.hex
  };
}

function parsePx(value: unknown): number | undefined {
  if (typeof value === "number") {
    return roundNumber(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem|em)?$/);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "px";
  return roundNumber(unit === "px" ? amount : amount * 16);
}

function parseOptionalPx(value: unknown): number | undefined {
  return value === undefined ? undefined : parsePx(value);
}

function parseOptionalLineHeight(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return roundNumber(value);
  }

  if (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)%$/.test(value)) {
    return roundNumber(Number(value.slice(0, -1)) / 100);
  }

  const px = parsePx(value);
  return (
    px ??
    (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)
      ? Number(value)
      : undefined)
  );
}

function parseOptionalWeight(value: unknown): number | undefined {
  const normalizeWeight = (weight: number): number | undefined =>
    Number.isFinite(weight) && weight >= 1 && weight <= 1000 ? weight : undefined;

  if (typeof value === "number") {
    return normalizeWeight(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const namedWeights: Record<string, number> = {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700
  };
  return namedWeights[value] ?? (/^\d+$/.test(value) ? normalizeWeight(Number(value)) : undefined);
}

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value.trim()) {
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }
    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitCssValue(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value.trim()) {
    if (/\s/.test(char) && depth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }
    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function tokenNameMatches(name: string, needles: string[]): boolean {
  return needles.some((needle) => name.includes(needle));
}

function resolveAliases(input: TokenInput, aliasValues: AliasValues, errors: string[]): TokenInput {
  let resolvedValue = input.originalValue;
  const seen = new Set([input.name]);

  while (isAlias(resolvedValue)) {
    const target = aliasTarget(resolvedValue, input.name, aliasValues);
    if (!target) {
      return input;
    }
    if (target.fallback !== undefined) {
      resolvedValue = target.fallback;
      continue;
    }

    if (seen.has(target.id)) {
      errors.push(tokenIssue(input, `${input.name}: circular token alias ${resolvedValue}`));
      return input;
    }

    if (target.value === undefined) {
      errors.push(tokenIssue(input, `${input.name}: unknown token alias ${resolvedValue}`));
      return input;
    }

    seen.add(target.id);
    resolvedValue = target.value;
  }

  return resolvedValue === input.originalValue ? input : { ...input, resolvedValue };
}

function resolveFieldAlias(
  value: unknown,
  aliasValues: AliasValues,
  errors: string[],
  input: TokenInput | string,
  fieldName: string
): unknown {
  let resolvedValue = value;
  const seen = new Set<string>();
  const tokenName = typeof input === "string" ? input : input.name;

  while (typeof resolvedValue === "string" && isAlias(resolvedValue)) {
    const target = aliasTarget(resolvedValue, tokenName, aliasValues);
    if (!target) {
      return value;
    }
    if (target.fallback !== undefined) {
      resolvedValue = target.fallback;
      continue;
    }

    if (seen.has(target.id)) {
      errors.push(
        fieldTokenIssue(input, `${tokenName}.${fieldName}: circular token alias ${resolvedValue}`)
      );
      return value;
    }

    if (target.value === undefined) {
      errors.push(
        fieldTokenIssue(input, `${tokenName}.${fieldName}: unknown token alias ${resolvedValue}`)
      );
      return value;
    }

    seen.add(target.id);
    resolvedValue = target.value;
  }

  return resolvedValue;
}

function fieldTokenIssue(input: TokenInput | string, issue: string): string {
  return typeof input === "string" ? issue : tokenIssue(input, issue);
}

function isAlias(value: string): boolean {
  return aliasPattern.test(value) || cssVarAliasPattern.test(value);
}

function aliasTarget(
  value: string,
  tokenName: string,
  aliasValues: AliasValues
): AliasTarget | undefined {
  const w3cTarget = value.match(aliasPattern)?.[0].slice(1, -1);
  if (w3cTarget) {
    return { id: `name:${w3cTarget}`, value: aliasValues.names.get(w3cTarget) };
  }

  const cssMatch = value.match(cssVarAliasPattern);
  const cssVariable = cssMatch?.[1];
  if (!cssVariable) {
    return undefined;
  }

  const scopedKey = cssVariableKey(cssVariable, tokenName.startsWith("dark."));
  const defaultKey = cssVariableKey(cssVariable, false);
  const targetKey = aliasValues.cssVariables.has(scopedKey) ? scopedKey : defaultKey;
  const valueFromCss = aliasValues.cssVariables.get(targetKey);
  const fallback = cssMatch[2]?.trim();
  if (valueFromCss !== undefined) {
    const selfAlias = selfCssVariableAlias(valueFromCss, cssVariable);
    if (selfAlias?.fallback) {
      return { id: `fallback:${cssVariable}`, fallback: selfAlias.fallback };
    }
    if (selfAlias && fallback) {
      return { id: `fallback:${cssVariable}`, fallback };
    }
    return { id: `css:${targetKey}`, value: valueFromCss };
  }

  return fallback
    ? { id: `fallback:${cssVariable}`, fallback }
    : { id: `css:${defaultKey}`, value: undefined };
}

function selfCssVariableAlias(
  value: string,
  cssVariable: string
): { fallback?: string } | undefined {
  const match = value.match(cssVarAliasPattern);
  if (match?.[1] !== cssVariable) {
    return undefined;
  }
  return { fallback: match[2]?.trim() };
}

function cssVariableKey(cssVariable: string, dark: boolean): string {
  return dark ? `dark:${cssVariable}` : cssVariable;
}

function emptyAliasValues(): AliasValues {
  return { names: new Map(), cssVariables: new Map() };
}

function isTypographyToken(type: string | undefined, name: string, value: string): boolean {
  const compactName = compactTokenName(name);
  const parsed = tryParseJson(value);
  return (
    type === "typography" ||
    Boolean(type?.includes("font")) ||
    Boolean(type?.includes("lineheight")) ||
    Boolean(type?.includes("letterspacing")) ||
    compactName.includes("typography") ||
    compactName.includes("font") ||
    compactName.includes("lineheight") ||
    compactName.includes("letterspacing") ||
    (isPlainObject(parsed) && isTypographyCompositeObject(parsed))
  );
}

function compactTokenName(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, "");
}

function hasTokenValue(value: Record<string, unknown>): boolean {
  return [...tokenKeys].some((key) => key in value);
}

function isCompositeTokenObject(value: Record<string, unknown>): boolean {
  return isTypographyCompositeObject(value) || isShadowCompositeObject(value);
}

function isTypographyCompositeObject(value: Record<string, unknown>): boolean {
  return [
    "fontFamily",
    "family",
    "fontSize",
    "size",
    "lineHeight",
    "fontWeight",
    "weight",
    "letterSpacing"
  ].some((key) => key in value && !isPlainObject(value[key]));
}

function isShadowCompositeObject(value: Record<string, unknown>): boolean {
  const hasShadowMetric = ["offsetX", "x", "offsetY", "y", "blur", "spread"].some(
    (key) => key in value && !isPlainObject(value[key])
  );
  return hasShadowMetric && "color" in value && !isPlainObject(value.color);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(value: Record<string, unknown>, primary: string, fallback: string): unknown {
  return primary in value ? value[primary] : value[fallback];
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyTokenValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const genericFontFamilyKeywords = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "math",
  "emoji",
  "fangsong"
]);

function looksLikeFontFamilyValue(value: string): boolean {
  const trimmed = stripQuotes(value.trim());
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes(",")) {
    return true;
  }
  return genericFontFamilyKeywords.has(trimmed.toLowerCase());
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return /^(['"]).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function roundNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
}

function tokenMetadata(input: TokenInput): {
  name: string;
  cssVariable?: string;
  originalValue: string;
} {
  return stripUndefined({
    name: input.name,
    cssVariable: input.cssVariable,
    originalValue: input.originalValue
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
