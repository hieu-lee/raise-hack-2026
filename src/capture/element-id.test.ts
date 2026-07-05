import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { elementIdFor, normalizeClassHint } from "./element-id.js";
import { collectRawDomSamples, toDomSamples, toObservationRecords } from "./dom-sampler.js";
import type { RawDomSample } from "./types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("element ids", () => {
  it("generates stable ids from route, DOM path, role, tag, and classes", async () => {
    await expect(readFile("fixtures/html/capture-sample.html", "utf8")).resolves.toContain(
      "plan-card"
    );

    const input = {
      routeId: "home",
      domPath: "body>main:nth-of-type(1)>article:nth-of-type(1)>button:nth-of-type(1)",
      role: "button",
      tagName: "button",
      classHint: "button primary"
    };

    expect(elementIdFor(input)).toBe(elementIdFor(input));
    expect(elementIdFor(input)).toBe("el_fe50622a490de6");
  });

  it("normalizes class order before hashing", () => {
    expect(normalizeClassHint("primary button primary")).toBe("button.primary");
    expect(
      elementIdFor({
        routeId: "home",
        domPath: "body>button:nth-of-type(1)",
        role: "button",
        tagName: "button",
        classHint: "primary button"
      })
    ).toBe(
      elementIdFor({
        routeId: "home",
        domPath: "body>button:nth-of-type(1)",
        role: "button",
        tagName: "button",
        classHint: "button primary"
      })
    );
  });
});

describe("DOM sample shaping", () => {
  const rawSample: RawDomSample = {
    domPath: "body>main:nth-of-type(1)>article:nth-of-type(1)",
    classHint: "card",
    selectorHint: '[data-testid="plan-card"]',
    role: undefined,
    tagName: "article",
    textSample: "Design plan",
    boundingBox: { x: 16, y: 16, width: 320, height: 160 },
    computed: {
      color: "rgb(15, 23, 42)",
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(210, 216, 224)",
      fontFamily: "Inter, sans-serif",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "normal",
      letterSpacing: "normal",
      margin: "16px 16px 16px 16px",
      padding: "20px 20px 20px 20px",
      gap: "normal",
      borderRadius: "12px 12px 12px 12px",
      boxShadow: "rgba(15, 23, 42, 0.12) 0px 2px 8px 0px",
      opacity: "1",
      cursor: "auto"
    }
  };

  it("adds deterministic ids and observation context", () => {
    const samples = toDomSamples([rawSample], "home");
    expect(samples[0]).toMatchObject({
      elementId: "el_e6d20a636045af",
      selectorHint: '[data-testid="plan-card"]',
      tagName: "article"
    });

    expect(toObservationRecords(samples, "home", "desktop", "default")[0]).toMatchObject({
      routeId: "home",
      viewport: "desktop",
      state: "default",
      elementId: "el_e6d20a636045af"
    });
  });

  it("falls back to a short class selector when no selector hint exists", () => {
    const samples = toDomSamples(
      [{ ...rawSample, selectorHint: "", classHint: "card panel" }],
      "home"
    );

    expect(samples[0]?.selectorHint).toBe("article.card.panel");
  });
});

describe("browser-side DOM collection", () => {
  it("excludes hidden and zero-size elements before shaping samples", () => {
    const visible = fakeElement("button", {
      className: "primary button",
      text: "Start",
      rect: { x: 10, y: 20, width: 80, height: 32 },
      style: baseStyle()
    });
    const hidden = fakeElement("button", {
      className: "hidden",
      text: "Hidden",
      rect: { x: 0, y: 0, width: 80, height: 32 },
      style: { ...baseStyle(), display: "none" }
    });
    const zero = fakeElement("span", {
      className: "zero",
      text: "Zero",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      style: baseStyle()
    });
    const body = {
      querySelectorAll: () => [visible, hidden, zero],
      children: [visible, hidden, zero]
    };

    for (const element of [visible, hidden, zero]) {
      element.parentElement = body;
    }

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()).toMatchObject([
      {
        tagName: "button",
        textSample: "Start",
        boundingBox: { width: 80, height: 32 }
      }
    ]);
  });

  it("treats numeric zero opacity values as hidden", () => {
    const transparent = fakeElement("button", {
      className: "",
      text: "Transparent",
      rect: { x: 0, y: 0, width: 80, height: 32 },
      style: { ...baseStyle(), opacity: "0.00" }
    });
    const body = {
      querySelectorAll: () => [transparent],
      children: [transparent]
    };
    transparent.parentElement = body;

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()).toEqual([]);
  });

  it("excludes collapsed elements", () => {
    const collapsed = fakeElement("button", {
      className: "",
      text: "Collapsed",
      rect: { x: 0, y: 0, width: 80, height: 32 },
      style: { ...baseStyle(), visibility: "collapse" }
    });
    const body = {
      querySelectorAll: () => [collapsed],
      children: [collapsed]
    };
    collapsed.parentElement = body;

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()).toEqual([]);
  });

  it("uses aria labels as selector hints", () => {
    const labeled = fakeElement("button", {
      className: "",
      text: "",
      rect: { x: 0, y: 0, width: 80, height: 32 },
      style: baseStyle(),
      attributes: { "aria-label": "Open account menu" }
    });
    const body = {
      querySelectorAll: () => [labeled],
      children: [labeled]
    };
    labeled.parentElement = body;

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()[0]?.selectorHint).toBe('button[aria-label="Open account menu"]');
  });

  it("escapes quotes in selector hints", () => {
    const labeled = fakeElement("button", {
      className: "",
      text: "",
      rect: { x: 0, y: 0, width: 80, height: 32 },
      style: baseStyle(),
      attributes: { "aria-label": 'Open "account" menu' }
    });
    const body = {
      querySelectorAll: () => [labeled],
      children: [labeled]
    };
    labeled.parentElement = body;

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()[0]?.selectorHint).toBe(
      'button[aria-label="Open \\"account\\" menu"]'
    );
  });

  it("prioritizes controls before text samples", () => {
    const paragraph = fakeElement("p", {
      className: "",
      text: "Long copy",
      rect: { x: 0, y: 0, width: 320, height: 24 },
      style: baseStyle()
    });
    const button = fakeElement("button", {
      className: "",
      text: "Save",
      rect: { x: 0, y: 32, width: 80, height: 32 },
      style: baseStyle()
    });
    const body = {
      querySelectorAll: () => [paragraph, button],
      children: [paragraph, button]
    };

    for (const element of [paragraph, button]) {
      element.parentElement = body;
    }

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples().map((sample) => sample.tagName)).toEqual(["button", "p"]);
  });

  it("samples painted backgrounds before plain text", () => {
    const paragraph = fakeElement("p", {
      className: "",
      text: "Long copy",
      rect: { x: 0, y: 0, width: 320, height: 24 },
      style: baseStyle()
    });
    const painted = fakeElement("section", {
      className: "",
      text: "",
      rect: { x: 0, y: 32, width: 320, height: 80 },
      style: { ...baseStyle(), backgroundColor: "rgb(255, 255, 255)" }
    });
    const body = {
      querySelectorAll: () => [paragraph, painted],
      children: [paragraph, painted]
    };

    for (const element of [paragraph, painted]) {
      element.parentElement = body;
    }

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples().map((sample) => sample.tagName)).toEqual(["section", "p"]);
  });

  it("samples card-like class names", () => {
    const card = fakeElement("div", {
      className: "card",
      text: "",
      rect: { x: 0, y: 0, width: 320, height: 80 },
      style: baseStyle()
    });
    const body = {
      querySelectorAll: () => [card],
      children: [card]
    };
    card.parentElement = body;

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()[0]?.tagName).toBe("div");
  });

  it("caps sampled elements at 250", () => {
    const elements = Array.from({ length: 251 }, (_, index) =>
      fakeElement("button", {
        className: "",
        text: `Button ${index}`,
        rect: { x: 0, y: index * 40, width: 80, height: 32 },
        style: baseStyle()
      })
    );
    const body = {
      querySelectorAll: () => elements,
      children: elements
    };

    for (const element of elements) {
      element.parentElement = body;
    }

    vi.stubGlobal("document", { body });
    vi.stubGlobal("getComputedStyle", (element: { style: CSSStyleDeclaration }) => element.style);

    expect(collectRawDomSamples()).toHaveLength(250);
  });
});

type FakeElementOptions = {
  className: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  style: CSSStyleDeclaration;
  attributes?: Record<string, string>;
};

function fakeElement(tagName: string, options: FakeElementOptions) {
  return {
    tagName: tagName.toUpperCase(),
    className: options.className,
    classList: options.className.split(/\s+/).filter(Boolean),
    innerText: options.text,
    parentElement: undefined as unknown,
    children: [],
    getBoundingClientRect: () => options.rect,
    getAttribute: (name: string) => options.attributes?.[name] ?? null,
    hasAttribute: (name: string) => name in (options.attributes ?? {}),
    closest: () => null,
    style: options.style
  };
}

function baseStyle(): CSSStyleDeclaration {
  return {
    display: "block",
    visibility: "visible",
    opacity: "1",
    color: "rgb(15, 23, 42)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderColor: "rgb(210, 216, 224)",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
    fontWeight: "400",
    lineHeight: "normal",
    letterSpacing: "normal",
    marginTop: "0px",
    marginRight: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
    gap: "normal",
    borderTopLeftRadius: "0px",
    borderTopRightRadius: "0px",
    borderBottomRightRadius: "0px",
    borderBottomLeftRadius: "0px",
    boxShadow: "none",
    cursor: "pointer"
  } as CSSStyleDeclaration;
}
