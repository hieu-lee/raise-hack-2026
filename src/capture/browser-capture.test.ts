import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDesignSurface, domAssetPath, screenshotAssetPath } from "./browser-capture.js";

const mocks = vi.hoisted(() => ({
  launch: vi.fn()
}));

vi.mock("@playwright/test", () => ({
  chromium: {
    launch: mocks.launch
  }
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("capture asset paths", () => {
  it("uses the required relative artifact contract", () => {
    expect(screenshotAssetPath("home", "desktop", "hover")).toBe(
      "screenshots/home/desktop/hover.png"
    );
    expect(domAssetPath("home", "mobile", "dark")).toBe("dom/home/mobile/dark.json");
  });
});

describe("captureDesignSurface", () => {
  it("returns page metadata, observations, and writes pages.json", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "driftradar-capture-test-"));
    const screenshot = vi.fn().mockResolvedValue(undefined);
    mocks.launch.mockResolvedValueOnce(fakeBrowser({ screenshot }));

    try {
      const result = await captureDesignSurface(baseConfig(runDir), { runDir });

      expect(result.warnings).toEqual([]);
      expect(result.pages).toMatchObject([
        {
          routeId: "home",
          viewport: "desktop",
          state: "default",
          screenshotPath: "screenshots/home/desktop/default.png",
          browser: { name: "chromium", version: "test-browser" }
        }
      ]);
      expect(result.observations).toMatchObject([
        {
          routeId: "home",
          viewport: "desktop",
          state: "default",
          tagName: "button"
        }
      ]);
      expect(JSON.parse(await readFile(join(runDir, "pages.json"), "utf8"))).toHaveLength(1);
      expect(
        JSON.parse(await readFile(join(runDir, "dom/home/desktop/default.json"), "utf8"))
      ).toMatchObject({
        routeId: "home",
        viewport: "desktop",
        state: "default",
        elements: [{ tagName: "button" }]
      });
      expect(screenshot).toHaveBeenCalledWith({
        path: join(runDir, "screenshots/home/desktop/default.png"),
        fullPage: true
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("records route warnings and still writes pages.json", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "driftradar-capture-test-"));
    mocks.launch.mockResolvedValueOnce(fakeBrowser({ gotoError: new Error("route unavailable") }));

    try {
      const result = await captureDesignSurface(baseConfig(runDir), { runDir });

      expect(result.pages).toEqual([]);
      expect(result.warnings).toMatchObject([{ routeId: "home", message: "route unavailable" }]);
      expect(JSON.parse(await readFile(join(runDir, "pages.json"), "utf8"))).toEqual([]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("records a warning when state application leaves the allowed origin", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "driftradar-capture-test-"));
    mocks.launch.mockResolvedValueOnce(
      fakeBrowser({ urlAfterHover: "https://example.com/off-origin" })
    );

    try {
      const result = await captureDesignSurface(
        { ...baseConfig(runDir), states: ["hover"] },
        { runDir, allowedOrigin: "http://127.0.0.1:4173" }
      );

      expect(result.pages).toEqual([]);
      expect(result.warnings).toMatchObject([
        { routeId: "home", message: expect.stringContaining("left local project origin") }
      ]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("blocks off-origin subresource requests when an allowed origin is set", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "driftradar-capture-test-"));
    const abort = vi.fn().mockResolvedValue(undefined);
    const routeContinue = vi.fn().mockResolvedValue(undefined);
    const browser = fakeBrowser({
      routeToTrigger: {
        abort,
        continue: routeContinue,
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "https://example.com/tracker.js"
        })
      }
    });
    mocks.launch.mockResolvedValueOnce(browser);

    try {
      await captureDesignSurface(baseConfig(runDir), {
        runDir,
        allowedOrigin: "http://127.0.0.1:4173"
      });

      expect(abort).toHaveBeenCalledWith("blockedbyclient");
      expect(routeContinue).not.toHaveBeenCalled();
      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ serviceWorkers: "block" })
      );
      expect(browser.context.route).toHaveBeenCalled();
      expect(browser.context.addInitScript).toHaveBeenCalled();
      expect(browser.page.on).toHaveBeenCalledWith("popup", expect.any(Function));
      expect(String(browser.context.addInitScript.mock.calls[0]?.[0])).toContain("window.Worker");
      expect(String(browser.context.addInitScript.mock.calls[0]?.[0])).toContain(
        "window.SharedWorker"
      );
      expect(String(browser.context.addInitScript.mock.calls[0]?.[0])).toContain(
        "RTCPeerConnection"
      );
      expect(String(browser.context.addInitScript.mock.calls[0]?.[0])).toContain("WebTransport");
      expect(String(browser.context.addInitScript.mock.calls[0]?.[0])).toContain("WebSocketStream");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("records context creation warnings", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "driftradar-capture-test-"));
    mocks.launch.mockResolvedValueOnce({
      version: () => "test-browser",
      newContext: vi.fn().mockRejectedValue(new Error("context unavailable")),
      close: vi.fn().mockResolvedValue(undefined)
    });

    try {
      const result = await captureDesignSurface(baseConfig(runDir), { runDir });

      expect(result.pages).toEqual([]);
      expect(result.warnings).toMatchObject([{ routeId: "home", message: "context unavailable" }]);
      expect(JSON.parse(await readFile(join(runDir, "pages.json"), "utf8"))).toEqual([]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

function baseConfig(outputDir: string) {
  return {
    projectName: "Capture test",
    baseUrl: "http://127.0.0.1:4173",
    routes: [{ id: "home", url: "/" }],
    tokenFiles: ["fixtures/config/tokens.css"],
    outputDir,
    viewports: [{ name: "desktop", width: 800, height: 600 }],
    states: ["default"],
    storybookMode: false,
    ollama: { enabled: false }
  } as const;
}

function fakeBrowser(
  options: {
    gotoError?: Error;
    routeToTrigger?: {
      abort: ReturnType<typeof vi.fn>;
      continue: ReturnType<typeof vi.fn>;
      request: () => { isNavigationRequest: () => boolean; url: () => string };
    };
    screenshot?: ReturnType<typeof vi.fn>;
    urlAfterHover?: string;
  } = {}
) {
  let currentUrl = "about:blank";
  const page = {
    goto: options.gotoError
      ? vi.fn().mockRejectedValue(options.gotoError)
      : vi.fn().mockImplementation(async (url: string) => {
          currentUrl = url;
        }),
    url: vi.fn(() => currentUrl),
    on: vi.fn(),
    emulateMedia: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([
      {
        domPath: "body>button:nth-of-type(1)",
        classHint: "primary",
        selectorHint: "button.primary",
        role: "button",
        tagName: "button",
        textSample: "Start",
        boundingBox: { x: 0, y: 0, width: 80, height: 32 },
        computed: {
          color: "rgb(15, 23, 42)",
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderColor: "rgb(15, 23, 42)",
          fontFamily: "Inter, sans-serif",
          fontSize: "16px",
          fontWeight: "400",
          lineHeight: "normal",
          letterSpacing: "normal",
          margin: "0px 0px 0px 0px",
          padding: "0px 0px 0px 0px",
          gap: "normal",
          borderRadius: "0px 0px 0px 0px",
          boxShadow: "none",
          opacity: "1",
          cursor: "pointer"
        }
      }
    ]),
    locator: vi.fn(() => ({
      first: vi.fn(() => ({
        hover: vi.fn().mockImplementation(async () => {
          currentUrl = options.urlAfterHover ?? currentUrl;
        }),
        focus: vi.fn().mockResolvedValue(undefined)
      }))
    })),
    screenshot: options.screenshot ?? vi.fn().mockResolvedValue(undefined)
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    route: vi
      .fn()
      .mockImplementation(
        async (
          _pattern: string,
          handler: (route: NonNullable<typeof options.routeToTrigger>) => unknown
        ) => {
          if (options.routeToTrigger) {
            await handler(options.routeToTrigger);
          }
        }
      ),
    addInitScript: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };

  return {
    context,
    page,
    version: () => "test-browser",
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined)
  };
}
