import { describe, expect, it } from "vitest";
import { browserEvaluableSource, toDomSamples, toObservationRecords } from "./dom-sampler.js";
import type { RawDomSample } from "./types.js";

describe("browserEvaluableSource", () => {
  it("strips esbuild's __name bookkeeping calls so the source runs standalone in a browser", () => {
    const source = browserEvaluableSource();

    expect(source).not.toContain("__name(");
    expect(source.startsWith("(function collectRawDomSamples")).toBe(true);
    expect(source.endsWith(")()")).toBe(true);
  });

  it("is valid, self-invoking JavaScript", () => {
    const source = browserEvaluableSource();
    expect(() => new Function(`"use strict"; return ${source};`)).not.toThrow();
  });
});

describe("toDomSamples / toObservationRecords", () => {
  const raw: RawDomSample = {
    domPath: "body>div:nth-of-type(1)",
    classHint: "primary-action",
    selectorHint: "",
    role: "button",
    tagName: "button",
    textSample: "Start scan",
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    computed: {
      color: "#ffffff",
      backgroundColor: "#1f6fe5",
      borderColor: "#1f6fe5",
      fontFamily: "Inter",
      fontSize: "16px",
      fontWeight: "600",
      lineHeight: "24px",
      letterSpacing: "0px",
      margin: "0px 0px 0px 0px",
      padding: "10px 18px 10px 18px",
      gap: "0px",
      borderRadius: "999px 999px 999px 999px",
      boxShadow: "none",
      opacity: "1",
      cursor: "pointer"
    }
  };

  it("derives a selectorHint fallback and a stable elementId from the class hint", () => {
    const [sample] = toDomSamples([raw], "buttons");
    expect(sample.selectorHint).toBe("button.primary-action");
    expect(sample.elementId).toMatch(/^el_[a-f0-9]{14}$/);
  });

  it("attaches route, viewport, and state to observation records", () => {
    const [sample] = toDomSamples([raw], "buttons");
    const [record] = toObservationRecords([sample], "buttons", "desktop", "hover");
    expect(record).toMatchObject({ routeId: "buttons", viewport: "desktop", state: "hover" });
  });
});
