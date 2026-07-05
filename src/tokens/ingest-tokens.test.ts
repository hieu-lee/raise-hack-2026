import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestTokenFiles, TokenIngestionError } from "./ingest-tokens.js";

function stableTimes<T extends { sourceFiles: { modifiedTime: string }[] }>(value: T): T {
  return {
    ...value,
    sourceFiles: value.sourceFiles.map((sourceFile) => ({
      ...sourceFile,
      modifiedTime: "<mtime>"
    }))
  };
}

describe("token ingestion", () => {
  it("normalizes CSS and W3C JSON tokens into the canonical contract", async () => {
    const tokens = await ingestTokenFiles([
      "fixtures/tokens/css-tokens.css",
      "fixtures/tokens/w3c.json"
    ]);
    const golden = JSON.parse(await readFile("fixtures/tokens/golden/tokens.json", "utf8"));

    expect(stableTimes(tokens)).toEqual(golden);
  });

  it("parses flat JSON tokens", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/flat.json"]);

    expect(tokens.colors[0]?.name).toBe("color.accent");
    expect(tokens.colors[1]).toMatchObject({
      name: "color.overlay",
      oklch: "oklch(0 0 0 / 0.24)",
      hex: "#0000003d"
    });
    expect(tokens.spacing[0]?.px).toBe(12);
    expect(tokens.radii[0]?.px).toBe(999);
    expect(tokens.typography[0]?.size).toBe(12);
    expect(tokens.typography[1]?.lineHeight).toBe(1.5);
    expect(tokens.shadows[0]).toMatchObject({ offsetY: 4, blur: 12 });
    expect(tokens.shadows).toContainEqual({
      name: "card.depth",
      originalValue:
        '{"offsetX":"0px","offsetY":"2px","blur":"8px","spread":"0px","color":"rgba(0, 0, 0, 0.24)"}',
      offsetX: 0,
      offsetY: 2,
      blur: 8,
      spread: 0,
      color: "#0000003d"
    });
    expect(tokens.typography).toContainEqual({
      name: "text.compact",
      originalValue: '{"fontFamily":"Inter","fontSize":"14px","lineHeight":"150%"}',
      family: "Inter",
      size: 14,
      lineHeight: 1.5
    });
  });

  it("resolves W3C token aliases", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/w3c-alias.json"]);

    expect(tokens.colors).toEqual([
      {
        name: "color.brand",
        originalValue: "#1e64d8",
        oklch: "oklch(0.5311 0.1911 260.3283)",
        hex: "#1e64d8"
      },
      {
        name: "color.semantic",
        originalValue: "{color.brand}",
        oklch: "oklch(0.5311 0.1911 260.3283)",
        hex: "#1e64d8"
      }
    ]);
  });

  it("resolves CSS variable aliases and shadow color tokens", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/css-alias.css"]);

    expect(tokens.colors).toContainEqual({
      name: "color-primary",
      cssVariable: "--color-primary",
      originalValue: "var(--color-brand, #1e64d8)",
      oklch: "oklch(0.5311 0.1911 260.3283)",
      hex: "#1e64d8"
    });
    expect(tokens.colors).toContainEqual({
      name: "dark.color-primary",
      cssVariable: "--color-primary",
      originalValue: "var(--color-brand)",
      oklch: "oklch(0.8091 0.0956 251.8128)",
      hex: "#93c5fd"
    });
    expect(tokens.colors).toContainEqual({
      name: "shadow-color",
      cssVariable: "--shadow-color",
      originalValue: "rgba(0, 0, 0, 0.24)",
      oklch: "oklch(0 0 0 / 0.24)",
      hex: "#0000003d"
    });
    expect(tokens.colors).toContainEqual({
      name: "font-color",
      cssVariable: "--font-color",
      originalValue: "#333333",
      oklch: "oklch(0.3211 0 0)",
      hex: "#333333"
    });
    expect(tokens.colors).toContainEqual({
      name: "dark.color-html-dark",
      cssVariable: "--color-html-dark",
      originalValue: "#93c5fd",
      oklch: "oklch(0.8091 0.0956 251.8128)",
      hex: "#93c5fd"
    });
    expect(tokens.colors).toContainEqual({
      name: "dark.color-root-dark",
      cssVariable: "--color-root-dark",
      originalValue: "#0f172a",
      oklch: "oklch(0.2077 0.0398 265.7549)",
      hex: "#0f172a"
    });
    expect(tokens.colors).toContainEqual({
      name: "color-shared",
      cssVariable: "--color-shared",
      originalValue: "#123456",
      oklch: "oklch(0.3192 0.0725 251.1685)",
      hex: "#123456"
    });
    expect(tokens.colors).toContainEqual({
      name: "dark.color-shared",
      cssVariable: "--color-shared",
      originalValue: "#123456",
      oklch: "oklch(0.3192 0.0725 251.1685)",
      hex: "#123456"
    });
    expect(tokens.shadows).toContainEqual({
      name: "shadow-card",
      cssVariable: "--shadow-card",
      originalValue: "0 2px 8px 0 var(--missing-shadow-color, rgba(0, 0, 0, 0.24))",
      offsetX: 0,
      offsetY: 2,
      blur: 8,
      spread: 0,
      color: "#0000003d"
    });
  });

  it("keeps CSS variable support files that feed recognizable color tokens", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-tokens-"));
    try {
      const channels = join(projectRoot, "channels.css");
      const semantic = join(projectRoot, "semantic.css");
      await writeFile(channels, ":root { --grey-700: 213, 11%, 31%; }", "utf8");
      await writeFile(semantic, ":root { --color-soft: hsl(var(--grey-700)); }", "utf8");

      const tokens = await ingestTokenFiles([channels, semantic]);

      expect(tokens.colors).toContainEqual(expect.objectContaining({ name: "color-soft" }));
      expect(tokens.sourceFiles.map((file) => file.path)).toEqual([channels, semantic]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("keeps chained CSS variable support files that feed recognizable color tokens", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-tokens-"));
    try {
      const raw = join(projectRoot, "raw.css");
      const channels = join(projectRoot, "channels.css");
      const semantic = join(projectRoot, "semantic.css");
      await writeFile(raw, ":root { --grey-700: 213, 11%, 31%; }", "utf8");
      await writeFile(channels, ":root { --surface-channel: var(--grey-700); }", "utf8");
      await writeFile(semantic, ":root { --color-soft: hsl(var(--surface-channel)); }", "utf8");

      const tokens = await ingestTokenFiles([raw, channels, semantic]);

      expect(tokens.colors).toContainEqual(expect.objectContaining({ name: "color-soft" }));
      expect(tokens.sourceFiles.map((file) => file.path)).toEqual([raw, channels, semantic]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses CSS var fallbacks when the provider is a direct self-reference", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "driftradar-tokens-"));
    try {
      const tokensPath = join(projectRoot, "tokens.css");
      await writeFile(
        tokensPath,
        ":root { --brand: var(--brand); --color-primary: var(--brand, #123456); }",
        "utf8"
      );

      const tokens = await ingestTokenFiles([tokensPath]);

      expect(tokens.colors).toContainEqual(
        expect.objectContaining({
          name: "color-primary",
          hex: "#123456"
        })
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves CSS variable aliases by custom property, not colliding JSON names", async () => {
    const tokens = await ingestTokenFiles([
      "fixtures/tokens/css-alias.css",
      "fixtures/tokens/css-alias-collision.json"
    ]);

    expect(tokens.colors).toContainEqual({
      name: "color-primary",
      cssVariable: "--color-primary",
      originalValue: "var(--color-brand, #1e64d8)",
      oklch: "oklch(0.5311 0.1911 260.3283)",
      hex: "#1e64d8"
    });
    expect(tokens.colors).toContainEqual(
      expect.objectContaining({
        name: "color-brand",
        originalValue: "#ff0000",
        hex: "#ff0000"
      })
    );
  });

  it("honors W3C typography subtypes before generic dimensions", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/w3c-typography-subtypes.json"]);

    expect(tokens.spacing).toEqual([]);
    expect(tokens.typography).toEqual([
      {
        name: "text.body",
        originalValue: "Inter",
        family: "Inter"
      },
      {
        name: "font.size.body",
        originalValue: "18px",
        size: 18
      },
      {
        name: "font.lineHeight.body",
        originalValue: "28px",
        lineHeight: 28
      }
    ]);
  });

  it("resolves W3C composite typography aliases", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/w3c-typography-alias.json"]);

    expect(tokens.typography).toContainEqual({
      name: "typography.body",
      originalValue:
        '{"fontFamily":"{font.family.body}","fontSize":"{font.size.semantic}","lineHeight":"{font.lineHeight.semantic}","fontWeight":600}',
      family: "Inter",
      size: 16,
      lineHeight: 1.5,
      weight: 600
    });
    expect(tokens.typography).toContainEqual({
      name: "typography.semantic",
      originalValue: "{typography.body}",
      family: "Inter",
      size: 16,
      lineHeight: 1.5,
      weight: 600
    });
  });

  it("normalizes W3C composite shadow tokens", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/w3c-composite-shadow.json"]);

    expect(tokens.shadows).toEqual([
      {
        name: "shadow.overlay",
        originalValue:
          '{"offsetX":"0px","offsetY":"{space.semantic2}","blur":"{space.8}","spread":"0px","color":"{color.semanticOverlay}"}',
        offsetX: 0,
        offsetY: 2,
        blur: 8,
        spread: 0,
        color: "#0000003d"
      }
    ]);
  });

  it("uses the final duplicate token value in source order", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/duplicate.css"]);

    expect(tokens.spacing).toEqual([
      {
        name: "space-2",
        cssVariable: "--space-2",
        originalValue: "8px",
        px: 8
      },
      {
        name: "space-dot",
        cssVariable: "--space-dot",
        originalValue: "0.5rem",
        px: 8
      }
    ]);
    expect(tokens.colors[0]).toMatchObject({
      name: "color-primary",
      originalValue: "#ffffff",
      hex: "#ffffff"
    });
    expect(tokens.radii[0]).toMatchObject({
      name: "border-radius-sm",
      px: 4
    });
    expect(tokens.radii[1]).toMatchObject({
      name: "radius-dot",
      px: 4
    });
  });

  it("parses leading-dot numeric strings", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/leading-dot.json"]);

    expect(tokens.spacing[0]).toMatchObject({ name: "space.dot", px: 8 });
    expect(tokens.radii[0]).toMatchObject({ name: "radius.dot", px: 4 });
    expect(tokens.typography[0]).toMatchObject({ name: "font.lineHeight", lineHeight: 0.5 });
  });

  it("reports malformed token values without crashing", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed.json"])).rejects.toThrow(
      TokenIngestionError
    );
    await expect(ingestTokenFiles(["fixtures/tokens/malformed.json"])).rejects.toThrow(
      /color.bad: expected a color token/
    );
  });

  it("rejects root-level non-object JSON token files", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-array.json"])).rejects.toThrow(
      /expected a JSON token object/
    );
  });

  it("reports null W3C token values without crashing", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-null.json"])).rejects.toThrow(
      /color.missing: expected a color token, got null/
    );
  });

  it("rejects explicit null composite fields", async () => {
    await expect(
      ingestTokenFiles(["fixtures/tokens/malformed-null-composite.json"])
    ).rejects.toThrow(/typography.bad.fontSize: expected a typography length, got null/);
    await expect(
      ingestTokenFiles(["fixtures/tokens/malformed-null-composite.json"])
    ).rejects.toThrow(/shadow.bad: expected a shadow token/);
  });

  it("rejects root-level nameless JSON tokens", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-root-token.json"])).rejects.toThrow(
      /token names must not be empty/
    );
  });

  it("rejects negative radius tokens", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-radius.css"])).rejects.toThrow(
      /radius-card: expected a radius length/
    );
  });

  it("rejects files with no recognizable token values", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-unknown.json"])).rejects.toThrow(
      /No recognizable tokens found/
    );
  });

  it("rejects unrecognizable token files even when another file is valid", async () => {
    await expect(
      ingestTokenFiles(["fixtures/tokens/css-tokens.css", "fixtures/tokens/malformed-unknown.json"])
    ).rejects.toThrow(/malformed-unknown\.json: No recognizable tokens found/);
  });

  it("reports invalid W3C composite typography fields", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-typography.json"])).rejects.toThrow(
      /typography.bad.fontSize: expected a typography length/
    );
  });

  it("rejects composite typography tokens without comparable fields", async () => {
    await expect(
      ingestTokenFiles(["fixtures/tokens/malformed-typography-empty.json"])
    ).rejects.toThrow(/typography.empty: expected at least one typography field/);
  });

  it("rejects impossible negative typography and shadow values", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-negative.css"])).rejects.toThrow(
      /space-negative: expected a spacing length/
    );
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-negative.css"])).rejects.toThrow(
      /font-size-body: expected a typography length/
    );
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-negative.css"])).rejects.toThrow(
      /font-weight-huge: expected a font weight/
    );
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-negative.css"])).rejects.toThrow(
      /shadow-too-many-lengths: expected a shadow token/
    );
  });

  it("skips CSS-wide keywords, Tailwind v4 namespace resets, and multi-layer shadows", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/css-real-world.css"]);

    expect(tokens.colors).toContainEqual(
      expect.objectContaining({ name: "color-real", originalValue: "#123456" })
    );
    expect(tokens.colors.some((color) => color.name === "color-current")).toBe(false);
    expect(tokens.typography).toContainEqual(
      expect.objectContaining({ name: "font-outfit", family: "Outfit, sans-serif" })
    );
    expect(tokens.typography.some((token) => token.name === "font-*")).toBe(false);
    expect(tokens.shadows).toContainEqual(
      expect.objectContaining({
        name: "shadow-theme-md",
        offsetX: 0,
        offsetY: 4,
        blur: 8,
        spread: -2
      })
    );
  });

  it("reads Tailwind CSS v4 tokens declared inside @theme blocks", async () => {
    const tokens = await ingestTokenFiles(["fixtures/tokens/tailwind-v4-theme.css"]);

    expect(tokens.colors).toContainEqual(
      expect.objectContaining({ name: "color-brand-500", originalValue: "#465fff" })
    );
    expect(tokens.colors).toContainEqual(
      expect.objectContaining({ name: "color-gray-900", originalValue: "#101828" })
    );
    expect(tokens.colors).toContainEqual(expect.objectContaining({ name: "color-soft" }));
    expect(tokens.typography).toContainEqual(
      expect.objectContaining({ name: "font-outfit", family: "Outfit, sans-serif" })
    );
    expect(tokens.typography.some((token) => token.name === "font-ubuntu-mono")).toBe(false);
    expect(tokens.shadows).toContainEqual(
      expect.objectContaining({ name: "shadow-theme-xs", offsetY: 1, blur: 2 })
    );
    expect(tokens.shadows).toContainEqual(
      expect.objectContaining({ name: "shadow-theme-hsl", offsetY: 2, blur: 4 })
    );
  });

  it("rejects non-string JSON font family values", async () => {
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-font-family.json"])).rejects.toThrow(
      /font.family: expected a font family string/
    );
    await expect(ingestTokenFiles(["fixtures/tokens/malformed-font-family.json"])).rejects.toThrow(
      /flatFont.fontFamily: expected a font family string/
    );
  });
});
