/* global console, process */

import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvLocal } from "../../scripts/load-env-local.mjs";

await loadEnvLocal();

const baseUrl = process.env.DRIFTRADAR_DEMO_URL ?? "http://127.0.0.1:5173/?fixture=1#/";
const outputDir = resolve(process.env.DRIFTRADAR_DEMO_OUT ?? "test-results/cinematic-demo");
const finalVideoPath = resolve(outputDir, "driftradar-cinematic-demo.webm");
const diagnosticsPath = resolve(outputDir, "diagnostics.json");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: outputDir, size: { width: 1440, height: 1000 } }
});
const page = await context.newPage();
page.setDefaultTimeout(8000);

const diagnostics = {
  baseUrl,
  console: [],
  pageErrors: [],
  requestsFailed: [],
  checkpoints: []
};

page.on("console", (message) => {
  const type = message.type();
  if (type === "warning" || type === "error") {
    diagnostics.console.push({ type, text: message.text() });
  }
});
page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
page.on("requestfailed", (request) =>
  diagnostics.requestsFailed.push({ url: request.url(), failure: request.failure()?.errorText })
);

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await installOverlay(page);

  await beat(page, "1/6 Scan summary", "DriftRadar opens on a captured UI run: 4 findings across 5 routes.", async () => {
    await expect(page.getByRole("heading", { name: /DriftRadar sample app/i })).toBeVisible();
    await expect(page.getByText(/Drift risk/i).first()).toBeVisible();
    await pointAt(page, page.getByText(/Drift risk/i).first());
  });

  await clickNav(page, "Walkthrough");
  await beat(
    page,
    "2/6 Evidence replay",
    "The walkthrough starts on the critical regression with screenshot, token, confidence, and source context.",
    async () => {
      await expect(page.getByRole("heading", { name: /Replay the review/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Focus ring regressed/i })).toBeVisible();
      await expect(page.getByText(/screenshots\/forms\/desktop\/focus\.png/i)).toBeVisible();
      await pointAt(page, page.getByRole("heading", { name: /Focus ring regressed/i }));
    }
  );

  await clickButton(page, /Next/i);
  await beat(page, "3/6 Release risk", "The replay narrows attention to the drift that blocks release.", async () => {
    await expect(page.getByRole("heading", { name: /Find the drift that blocks release/i })).toBeVisible();
    await expect(page.getByText(/critical or high priority/i)).toBeVisible();
    await pointAt(page, page.getByText(/Drift risk/i).last());
  }, { expectTop: false });

  await clickButton(page, /Next/i);
  await beat(page, "4/6 Source fix", "The handoff becomes an exact source-aware fix instead of another screenshot debate.", async () => {
    await expect(page.getByRole("heading", { name: /Use the shared focus-ring token/i })).toBeVisible();
    await expect(page.getByText(/outline-color: var\(--color-focus-ring\);/i)).toBeVisible();
    await pointAt(page, page.getByText(/outline-color: var\(--color-focus-ring\);/i));
  }, { expectTop: false });

  await clickNav(page, "Issues");
  await beat(page, "5/6 Issue workbench", "The same finding is inspectable with evidence, reasoning, metadata, and suggested fix.", async () => {
    await expect(page.getByRole("heading", { name: /^Issues$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Focus ring regressed/i })).toBeVisible();
    await expect(page.getByText(/Suggested fix/i).first()).toBeVisible();
    await pointAt(page, page.getByRole("heading", { name: /Focus ring regressed/i }));
  });

  await clickNav(page, "Export");
  await beat(page, "6/6 PR packet", "The final artifact is a PR-ready review packet with observed values, screenshots, and source hints.", async () => {
    await expect(page.getByRole("heading", { name: /Review packet/i })).toBeVisible();
    await expect(page.getByText(/4 copy-ready PR comments/i)).toBeVisible();
    await expect(page.getByLabel("PR comment preview")).toContainText("Observed: `#ff4d4f`");
    await expect(page.getByLabel("PR comment preview")).toContainText(
      "Screenshot: `screenshots/forms/desktop/focus.png`"
    );
    await expect(page.getByLabel("PR comment preview")).toContainText("Source hint: `.dark-preview`");
    await pointAt(page, page.getByLabel("PR comment preview"));
  });

  await setOverlay(page, "Done", "Ready to submit: one reliable workflow, recorded from the real app.");
  await page.waitForTimeout(1400);

  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  const rawVideoPath = video ? await video.path() : undefined;
  if (!rawVideoPath || !existsSync(rawVideoPath)) {
    throw new Error("Playwright did not produce a video artifact.");
  }
  mkdirSync(dirname(finalVideoPath), { recursive: true });
  renameSync(rawVideoPath, finalVideoPath);
  diagnostics.videoPath = finalVideoPath;
  diagnostics.videoBytes = statSync(finalVideoPath).size;

  const actionableConsole = diagnostics.console.filter(
    (entry) => !/Download the React DevTools/i.test(entry.text)
  );
  if (actionableConsole.length || diagnostics.pageErrors.length || diagnostics.requestsFailed.length) {
    throw new Error(
      `Recording diagnostics found warnings/errors: ${JSON.stringify(
        {
          console: actionableConsole,
          pageErrors: diagnostics.pageErrors,
          requestsFailed: diagnostics.requestsFailed
        },
        null,
        2
      )}`
    );
  }
  if (diagnostics.videoBytes < 10000) {
    throw new Error(`Recorded video is too small: ${diagnostics.videoBytes} bytes`);
  }

  writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));
  console.log(`Recorded ${finalVideoPath}`);
  console.log(`Diagnostics ${diagnosticsPath}`);
} catch (error) {
  writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  throw error;
}

async function beat(page, title, caption, assertion, options = {}) {
  await setOverlay(page, title, caption);
  await assertion();
  await page.waitForTimeout(900);
  await checkpoint(page, title, options);
  await page.waitForTimeout(900);
}

async function checkpoint(page, name, { expectTop = true } = {}) {
  const metrics = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    url: window.location.href
  }));
  if (metrics.overflow > 1) {
    throw new Error(`${name}: page overflows horizontally by ${metrics.overflow}px`);
  }
  if (expectTop && (metrics.x !== 0 || metrics.y !== 0)) {
    throw new Error(`${name}: scroll did not reset ${JSON.stringify(metrics)}`);
  }
  diagnostics.checkpoints.push({ name, metrics });
}

async function clickNav(page, name) {
  const link = page.getByRole("navigation", { name: /Dashboard/i }).getByRole("link", { name });
  await pointAt(page, link);
  await link.click();
}

async function clickButton(page, name) {
  const button = page.getByRole("button", { name });
  await pointAt(page, button);
  await button.click();
}

async function pointAt(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = Math.round(box.x + Math.min(box.width / 2, box.width - 8));
  const y = Math.round(box.y + Math.min(box.height / 2, box.height - 8));
  await page.evaluate(
    ({ x, y }) => {
      const cursor = document.querySelector("[data-demo-cursor]");
      cursor?.setAttribute("style", `transform: translate(${x}px, ${y}px);`);
    },
    { x, y }
  );
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(250);
}

async function setOverlay(page, title, caption) {
  await page.evaluate(
    ({ title, caption }) => {
      const titleNode = document.querySelector("[data-demo-title]");
      const captionNode = document.querySelector("[data-demo-caption]");
      if (titleNode) titleNode.textContent = title;
      if (captionNode) captionNode.textContent = caption;
    },
    { title, caption }
  );
}

async function installOverlay(page) {
  await page.addStyleTag({
    content: `
      [data-demo-overlay] {
        position: fixed;
        left: 28px;
        right: 28px;
        bottom: 24px;
        z-index: 99999;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: center;
        padding: 14px 18px;
        border: 1px solid rgb(34 211 238 / 35%);
        border-radius: 18px;
        background: rgb(2 6 23 / 86%);
        box-shadow: 0 24px 90px rgb(0 0 0 / 45%);
        color: #f8fafc;
        font: 600 16px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
        backdrop-filter: blur(16px);
      }
      [data-demo-title] {
        padding: 7px 11px;
        border-radius: 999px;
        background: linear-gradient(135deg, #22d3ee, #8b5cf6);
        color: #020617;
        font-size: 13px;
        letter-spacing: 0.01em;
        white-space: nowrap;
      }
      [data-demo-caption] {
        color: #e2e8f0;
        text-wrap: balance;
      }
      [data-demo-cursor] {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 100000;
        width: 22px;
        height: 22px;
        border: 2px solid #22d3ee;
        border-radius: 999px;
        background: rgb(34 211 238 / 18%);
        box-shadow: 0 0 0 8px rgb(34 211 238 / 12%), 0 10px 30px rgb(0 0 0 / 35%);
        pointer-events: none;
        transition: transform 220ms ease;
      }
    `
  });
  await page.evaluate(() => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-demo-overlay", "");
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <span data-demo-title>Starting</span>
      <span data-demo-caption>Recording DriftRadar's real app flow.</span>
    `;
    document.body.append(overlay);
    const cursor = document.createElement("div");
    cursor.setAttribute("data-demo-cursor", "");
    cursor.setAttribute("style", "transform: translate(720px, 500px);");
    document.body.append(cursor);
  });
}
