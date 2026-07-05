import { mkdir, writeFile } from "node:fs/promises";
import path, { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import type { DriftRadarConfig, PageCapture } from "../contracts/types.js";
import { applyCaptureState } from "../states/apply-state.js";
import { sampleDom, toObservationRecords } from "./dom-sampler.js";
import type { CaptureOptions, CaptureResult, DomSampleDocument } from "./types.js";

export async function captureDesignSurface(
  config: DriftRadarConfig,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const runId = options.runId ?? `capture-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = options.runDir ?? join(config.outputDir, "runs", runId);
  const pages: PageCapture[] = [];
  const observations: CaptureResult["observations"] = [];
  const warnings: CaptureResult["warnings"] = [];
  const browser = await chromium.launch();

  try {
    const browserVersion = browser.version();
    for (const route of config.routes) {
      const url = new URL(route.url, config.baseUrl).toString();

      for (const viewport of config.viewports) {
        for (const state of config.states) {
          const context = await browser
            .newContext({
              viewport: { width: viewport.width, height: viewport.height },
              reducedMotion: "reduce",
              serviceWorkers: options.allowedOrigin ? "block" : "allow",
              timezoneId: options.browserOptions?.timezoneId ?? "UTC",
              locale: options.browserOptions?.locale ?? "en-US"
            })
            .catch((error) => {
              warnings.push({
                routeId: route.id,
                url,
                message: error instanceof Error ? error.message : String(error)
              });
              return undefined;
            });

          if (!context) continue;

          try {
            await blockOffOriginRequests(context, options.allowedOrigin);
            await blockBrowserEgress(context, options.allowedOrigin);
            const page = await context.newPage();
            blockPopups(page, options.allowedOrigin);
            await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
            assertAllowedOrigin(page, options.allowedOrigin);
            await applyCaptureState(page, state);
            assertAllowedOrigin(page, options.allowedOrigin);

            const screenshotPath = screenshotAssetPath(route.id, viewport.name, state);
            const domPath = domAssetPath(route.id, viewport.name, state);
            assertAllowedOrigin(page, options.allowedOrigin);
            const samples = await sampleDom(page, route.id);
            assertAllowedOrigin(page, options.allowedOrigin);
            const domDocument: DomSampleDocument = {
              routeId: route.id,
              viewport: viewport.name,
              state,
              elements: samples
            };

            await mkdir(join(runDir, "screenshots", route.id, viewport.name), { recursive: true });
            await mkdir(join(runDir, "dom", route.id, viewport.name), { recursive: true });
            await page.screenshot({ path: join(runDir, screenshotPath), fullPage: true });
            await writeFile(join(runDir, domPath), `${JSON.stringify(domDocument, null, 2)}\n`);

            pages.push({
              routeId: route.id,
              viewport: viewport.name,
              state,
              screenshotPath,
              capturedAt: new Date().toISOString(),
              browser: { name: "chromium", version: browserVersion }
            });
            observations.push(...toObservationRecords(samples, route.id, viewport.name, state));
          } catch (error) {
            warnings.push({
              routeId: route.id,
              url,
              message: error instanceof Error ? error.message : String(error)
            });
          } finally {
            await context.close();
          }
        }
      }
    }

    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "pages.json"), `${JSON.stringify(pages, null, 2)}\n`);

    return { runDir, pages, observations, warnings };
  } finally {
    await browser.close();
  }
}

async function blockBrowserEgress(
  context: BrowserContext,
  allowedOrigin: string | undefined
): Promise<void> {
  if (!allowedOrigin) {
    return;
  }

  await context.addInitScript(() => {
    const blocked = (api: string) =>
      new DOMException(`${api} blocked during DriftRadar capture`, "SecurityError");

    class BlockedWebSocket extends EventTarget {
      static readonly CLOSED = 3;
      static readonly CLOSING = 2;
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      binaryType: BinaryType = "blob";
      readonly bufferedAmount = 0;
      readonly extensions = "";
      onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
      onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
      onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
      onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
      readonly protocol = "";
      readonly readyState = WebSocket.CLOSED;
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        queueMicrotask(() => {
          const event = new Event("error");
          this.onerror?.call(this as unknown as WebSocket, event);
          this.dispatchEvent(event);
        });
      }

      close(): void {}
      send(): void {
        throw new DOMException("WebSocket blocked during DriftRadar capture", "InvalidStateError");
      }
    }

    window.WebSocket = BlockedWebSocket as unknown as typeof WebSocket;
    window.Worker = class BlockedWorker {
      constructor() {
        throw blocked("Worker");
      }
    } as unknown as typeof Worker;
    if ("SharedWorker" in window) {
      window.SharedWorker = class BlockedSharedWorker {
        constructor() {
          throw blocked("SharedWorker");
        }
      } as unknown as typeof SharedWorker;
    }
    if ("RTCPeerConnection" in window) {
      window.RTCPeerConnection = class BlockedRTCPeerConnection {
        constructor() {
          throw blocked("RTCPeerConnection");
        }
      } as unknown as typeof RTCPeerConnection;
    }
    if ("webkitRTCPeerConnection" in window) {
      (
        window as Window & { webkitRTCPeerConnection?: typeof RTCPeerConnection }
      ).webkitRTCPeerConnection = class BlockedWebkitRTCPeerConnection {
        constructor() {
          throw blocked("webkitRTCPeerConnection");
        }
      } as unknown as typeof RTCPeerConnection;
    }
    if ("WebTransport" in window) {
      (window as Window & { WebTransport?: new (...args: unknown[]) => unknown }).WebTransport =
        class BlockedWebTransport {
          constructor() {
            throw blocked("WebTransport");
          }
        };
    }
    if ("WebSocketStream" in window) {
      (
        window as Window & { WebSocketStream?: new (...args: unknown[]) => unknown }
      ).WebSocketStream = class BlockedWebSocketStream {
        constructor() {
          throw blocked("WebSocketStream");
        }
      };
    }
  });
}

async function blockOffOriginRequests(
  context: BrowserContext,
  allowedOrigin: string | undefined
): Promise<void> {
  if (!allowedOrigin) {
    return;
  }

  await context.route("**/*", async (route) => {
    const request = route.request();
    try {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol) && url.origin !== allowedOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
    } catch {
      if (request.isNavigationRequest()) {
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.continue();
  });
}

function blockPopups(page: Page, allowedOrigin: string | undefined): void {
  if (!allowedOrigin) {
    return;
  }
  page.on("popup", (popup) => {
    popup.close().catch(() => undefined);
  });
}

function assertAllowedOrigin(page: Page, allowedOrigin: string | undefined): void {
  if (!allowedOrigin) {
    return;
  }
  const currentUrl = page.url();
  if (currentUrl !== "about:blank" && new URL(currentUrl).origin !== allowedOrigin) {
    throw new Error(`Navigation left local project origin: ${currentUrl}`);
  }
}

export function screenshotAssetPath(routeId: string, viewport: string, state: string): string {
  return posixJoin("screenshots", routeId, viewport, `${state}.png`);
}

export function domAssetPath(routeId: string, viewport: string, state: string): string {
  return posixJoin("dom", routeId, viewport, `${state}.json`);
}

function posixJoin(...parts: string[]): string {
  return path.posix.join(...parts);
}
