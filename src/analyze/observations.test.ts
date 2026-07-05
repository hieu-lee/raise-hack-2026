import { describe, expect, it } from "vitest";
import type { ObservationRecord, TokenSet } from "../contracts/types.js";
import { analyzeObservations } from "./observations.js";

const tokens: TokenSet = {
  sourceFiles: [],
  colors: [
    {
      name: "color-primary-600",
      cssVariable: "--color-primary-600",
      originalValue: "#1f65d6",
      oklch: "oklch(0.53 0.19 260)",
      hex: "#1f65d6"
    },
    {
      name: "color-white",
      cssVariable: "--color-white",
      originalValue: "#ffffff",
      oklch: "oklch(1 0 0)",
      hex: "#ffffff"
    }
  ],
  spacing: [{ name: "space-16", cssVariable: "--space-16", px: 16 }],
  radii: [{ name: "radius-sm", cssVariable: "--radius-sm", px: 4 }],
  typography: [],
  shadows: []
};

describe("observation analysis", () => {
  it("marks near token values without treating literals as exact matches", () => {
    const [record] = recordsWithHeights([40]);
    const analysis = analyzeObservations([record], tokens);
    const color = analysis.observations.find(
      (observation) => observation.sourceProperty === "backgroundColor"
    );

    expect(color?.nearestToken?.name).toBe("color-primary-600");
    expect(color?.exactToken).toBe(false);
  });

  it("clusters repeated untokenized component heights", () => {
    const analysis = analyzeObservations(recordsWithHeights([44, 45, 44]), tokens);
    const heights = analysis.observations.filter(
      (observation) => observation.sourceProperty === "height"
    );

    expect(heights).toHaveLength(3);
    expect(heights.every((height) => height.occurrenceCount === 3)).toBe(true);
    expect(new Set(heights.map((height) => height.clusterId)).size).toBe(1);
  });

  it("matches translucent tokens from original values before RGB fallbacks", () => {
    const alphaTokens: TokenSet = {
      ...tokens,
      colors: [
        {
          name: "color-primary-alpha",
          cssVariable: "--color-primary-alpha",
          originalValue: "rgba(31, 101, 214, 0.5)",
          oklch: "oklch(0.53 0.19 260 / 0.5)",
          hex: "#1f65d6"
        }
      ]
    };
    const [record] = recordsWithHeights([40]);
    const analysis = analyzeObservations(
      [
        {
          ...record,
          computed: { ...record.computed, backgroundColor: "rgba(31, 101, 214, 0.5)" }
        }
      ],
      alphaTokens
    );
    const color = analysis.observations.find(
      (observation) => observation.sourceProperty === "backgroundColor"
    );

    expect(color?.nearestToken?.name).toBe("color-primary-alpha");
    expect(color?.exactToken).toBe(true);
  });

  it("does not treat transparent token hex fallbacks as opaque tokens", () => {
    const transparentTokens: TokenSet = {
      ...tokens,
      colors: [
        {
          name: "color-transparent",
          cssVariable: "--color-transparent",
          originalValue: "rgba(0, 0, 0, 0)",
          oklch: "oklch(0 0 0 / 0)",
          hex: "#000000"
        }
      ]
    };
    const [record] = recordsWithHeights([40]);
    const analysis = analyzeObservations(
      [{ ...record, computed: { ...record.computed, backgroundColor: "#000000" } }],
      transparentTokens
    );
    const color = analysis.observations.find(
      (observation) => observation.sourceProperty === "backgroundColor"
    );

    expect(color?.nearestToken).toBeUndefined();
  });

  it("normalizes token typography families the same way as observed font stacks", () => {
    const typographyTokens: TokenSet = {
      ...tokens,
      typography: [
        {
          family: "Inter, sans-serif",
          size: 16,
          lineHeight: 24,
          weight: 400,
          letterSpacing: 0
        }
      ]
    };
    const [record] = recordsWithHeights([40]);
    const analysis = analyzeObservations([record], typographyTokens);
    const typography = analysis.observations.find(
      (observation) => observation.property === "typography"
    );

    expect(typography?.exactToken).toBe(true);
  });
});

function recordsWithHeights(heights: number[]): ObservationRecord[] {
  return heights.map((height, index) => ({
    routeId: "buttons",
    viewport: "desktop",
    state: "default",
    elementId: `button-${index}`,
    selectorHint: ".button",
    role: "button",
    tagName: "button",
    textSample: "Save",
    boundingBox: { x: 0, y: index * 50, width: 120, height },
    computed: {
      color: "#ffffff",
      backgroundColor: "#1E64D8",
      borderColor: "rgba(0, 0, 0, 0)",
      fontFamily: "Inter, sans-serif",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "24px",
      letterSpacing: "0px",
      margin: "0px",
      padding: "16px",
      gap: "0px",
      borderRadius: "4px",
      boxShadow: "none",
      opacity: "1",
      cursor: "pointer"
    }
  }));
}
