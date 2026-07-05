import type { Page } from "@playwright/test";
import type { DomSample, ObservationRecord } from "../contracts/types.js";
import { elementIdFor, normalizeClassHint } from "./element-id.js";
import type { CaptureState, RawDomSample } from "./types.js";

export async function sampleDom(page: Page, routeId: string): Promise<DomSample[]> {
  const rawSamples = await page.evaluate<RawDomSample[]>(browserEvaluableSource());
  return toDomSamples(rawSamples, routeId);
}

// ponytail: dev-mode `tsx` compiles this file with esbuild's `keepNames` transform, which injects
// `__name(fn, "fn")` bookkeeping statements inside `collectRawDomSamples`'s body (for every nested
// helper function). `Function.prototype.toString()` includes those statements verbatim, and
// Playwright serializes that string into the page context, where `__name` does not exist,
// throwing `ReferenceError: __name is not defined`. Stripping the no-op wrapper calls before
// evaluating fixes real (Playwright) capture under `tsx`; it is a harmless no-op against the
// plain `tsc` build, which never emits them. Upgrade path: drop this once tsx's esbuild pass
// coalesces `page.evaluate` targets or exposes a way to disable `keepNames`.
export function browserEvaluableSource(): string {
  const cleaned = collectRawDomSamples
    .toString()
    .replace(/__name\(\s*[\w$]+\s*,\s*"[^"]*"\s*\);?/g, "");
  return `(${cleaned})()`;
}

export function toDomSamples(samples: RawDomSample[], routeId: string): DomSample[] {
  return samples.map(({ domPath, classHint, ...sample }) => ({
    ...sample,
    elementId: elementIdFor({
      routeId,
      domPath,
      role: sample.role,
      tagName: sample.tagName,
      classHint
    }),
    selectorHint: sample.selectorHint || selectorFallback(sample.tagName, classHint)
  }));
}

export function toObservationRecords(
  samples: DomSample[],
  routeId: string,
  viewport: string,
  state: CaptureState
): ObservationRecord[] {
  return samples.map((sample) => ({ ...sample, routeId, viewport, state }));
}

function selectorFallback(tagName: string, classHint: string): string {
  const normalized = normalizeClassHint(classHint);
  return normalized ? `${tagName.toLowerCase()}.${normalized}` : tagName.toLowerCase();
}

export function collectRawDomSamples(): RawDomSample[] {
  type Candidate = {
    element: HTMLElement;
    rect: DOMRect;
    computed: CSSStyleDeclaration;
  };

  function isVisible({ rect, computed }: Candidate): boolean {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      computed.display !== "none" &&
      computed.visibility !== "hidden" &&
      computed.visibility !== "collapse" &&
      Number(computed.opacity) > 0
    );
  }

  function interestRank({ element, computed }: Candidate): number {
    const tag = element.tagName.toLowerCase();
    const text = textSampleFor(element);
    const borderWidth = ["Top", "Right", "Bottom", "Left"].some(
      (side) => computed[`border${side}Width` as keyof CSSStyleDeclaration] !== "0px"
    );

    if (
      ["button", "a", "input", "select", "textarea", "summary"].includes(tag) ||
      Boolean(element.getAttribute("role")) ||
      element.hasAttribute("tabindex") ||
      element.hasAttribute("contenteditable")
    ) {
      return 1;
    }

    if (
      ["nav", "article"].includes(tag) ||
      Boolean(element.closest("nav") && text) ||
      /(^|\s)(card|panel|tile|nav-item|button)(\s|$)/i.test(element.className) ||
      hasPaintedBackground(computed.backgroundColor) ||
      borderWidth
    ) {
      return 2;
    }

    if (["p", "span", "label", "li", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      return 3;
    }

    return 0;
  }

  function hasPaintedBackground(backgroundColor: string): boolean {
    return !["rgba(0, 0, 0, 0)", "transparent"].includes(backgroundColor);
  }

  function roleFor(element: HTMLElement): string | undefined {
    const explicit = element.getAttribute("role");
    if (explicit) {
      return explicit;
    }

    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (["input", "select", "textarea"].includes(tag)) return "textbox";
    if (tag === "nav") return "navigation";
    return undefined;
  }

  function domPathFor(element: HTMLElement): string {
    const parts: string[] = [];
    for (let current: Element | null = element; current && current !== document.body;) {
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      const tagName = current.tagName;
      const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === tagName);
      parts.unshift(
        `${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`
      );
      current = parent;
    }
    return `body>${parts.join(">")}`;
  }

  function selectorHintFor(element: HTMLElement, tagName: string, classHint: string): string {
    const testId = element.getAttribute("data-testid");
    if (testId) return `[data-testid="${cssString(testId.slice(0, 80))}"]`;

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return `${tagName}[aria-label="${cssString(ariaLabel.slice(0, 40))}"]`;

    return classHint ? `${tagName}.${classHint.split(/\s+/).join(".")}` : tagName;
  }

  function cssString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function textSampleFor(element: HTMLElement): string | undefined {
    const text = (element.innerText || element.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim();
    return text ? text.slice(0, 120) : undefined;
  }

  function boxValue(computed: CSSStyleDeclaration, name: "margin" | "padding"): string {
    return ["Top", "Right", "Bottom", "Left"]
      .map((side) => computed[`${name}${side}` as keyof CSSStyleDeclaration])
      .join(" ");
  }

  function radiusValue(computed: CSSStyleDeclaration): string {
    return ["TopLeft", "TopRight", "BottomRight", "BottomLeft"]
      .map((corner) => computed[`border${corner}Radius` as keyof CSSStyleDeclaration])
      .join(" ");
  }

  function round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  const interesting = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
      computed: getComputedStyle(element),
      rank: 0
    }))
    .filter(isVisible)
    .map((candidate) => ({ ...candidate, rank: interestRank(candidate) }))
    .filter((candidate) => candidate.rank > 0)
    .sort((a, b) => a.rank - b.rank)
    // ponytail: cap keeps fixture-size artifacts bounded; score/stream if pages miss key elements.
    .slice(0, 250);

  return interesting.map(({ element, rect, computed }) => {
    const tagName = element.tagName.toLowerCase();
    const role = roleFor(element);
    const classHint = Array.from(element.classList).slice(0, 3).join(" ");

    return {
      domPath: domPathFor(element),
      classHint,
      selectorHint: selectorHintFor(element, tagName, classHint),
      role,
      tagName,
      textSample: textSampleFor(element),
      boundingBox: {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height)
      },
      computed: {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        borderColor: computed.borderColor,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        margin: boxValue(computed, "margin"),
        padding: boxValue(computed, "padding"),
        gap: computed.gap,
        borderRadius: radiusValue(computed),
        boxShadow: computed.boxShadow,
        opacity: computed.opacity,
        cursor: computed.cursor
      }
    };
  });
}
