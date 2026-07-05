import type { Page } from "@playwright/test";
import type { CaptureState } from "../capture/types.js";

const stateTarget = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[role=button]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export async function applyCaptureState(page: Page, state: CaptureState): Promise<void> {
  if (state === "dark") {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    });
    return;
  }

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });

  if (state === "hover") {
    await page
      .locator(stateTarget)
      .first()
      .hover({ trial: false })
      .catch(() => undefined);
  }

  if (state === "focus") {
    await page
      .locator(stateTarget)
      .first()
      .focus()
      .catch(() => undefined);
  }

  if (state === "disabled") {
    await page
      .evaluate((selector: string) => {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) return;
        target.setAttribute("aria-disabled", "true");
        if ("disabled" in target) {
          (target as HTMLButtonElement).disabled = true;
        }
      }, stateTarget)
      .catch(() => undefined);
  }
}
