import { describe, expect, it } from "vitest";
import { colorDistance, normalizeColor, normalizeShadow, normalizeTypography } from "./distance.js";

describe("color metrics", () => {
  it("normalizes CSS colors and detects near token values", () => {
    expect(normalizeColor("rgb(30, 100, 216)")).toBe("#1e64d8");
    expect(colorDistance("#1E64D8", "#1f65d6")).toBeLessThan(0.04);
  });

  it("preserves alpha so translucent colors do not become exact token matches", () => {
    expect(normalizeColor("rgba(31, 101, 214, 0.5)")).toBe("rgba(31, 101, 214, 0.5)");
    expect(colorDistance("rgba(31, 101, 214, 0.5)", "#1f65d6")).toBeGreaterThan(0.04);
  });

  it("parses browser color-first shadows without treating rgba channels as offsets", () => {
    expect(normalizeShadow("rgba(0, 0, 0, 0.25) 0px 2px 4px 0px")).toMatchObject({
      offsetX: 0,
      offsetY: 2,
      blur: 4,
      spread: 0,
      color: "rgba(0, 0, 0, 0.25)"
    });
  });

  it("parses only the first shadow layer without reading later rgba channels as spread", () => {
    expect(
      normalizeShadow("rgba(0, 0, 0, 0.25) 0px 2px 4px, rgba(31, 101, 214, 0.2) 0px 4px 8px")
    ).toMatchObject({
      offsetX: 0,
      offsetY: 2,
      blur: 4,
      spread: 0,
      color: "rgba(0, 0, 0, 0.25)"
    });
  });

  it("expands unitless line-height against font size", () => {
    expect(
      normalizeTypography({
        fontFamily: "Inter, sans-serif",
        fontSize: "16px",
        fontWeight: "400",
        lineHeight: "1.5",
        letterSpacing: "0px"
      }).lineHeight
    ).toBe(24);
  });
});
