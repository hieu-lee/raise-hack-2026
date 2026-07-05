import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const dashboardUrl = process.env.DRIFTRADAR_DASHBOARD_URL;
const smokeViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

test.describe("DriftRadar dashboard smoke", () => {
  test.skip(!dashboardUrl, "Set DRIFTRADAR_DASHBOARD_URL to run browser smoke checks.");

  test("covers the fixture-mode primary flow on desktop and mobile", async ({ page }) => {
    test.skip(
      process.env.DRIFTRADAR_EXPECT_LIVE === "1",
      "Live-mode smoke skips fixture assertions."
    );

    for (const viewport of smokeViewports) {
      await page.setViewportSize(viewport);
      await page.goto(dashboardUrl!);
      await expect(page.getByRole("navigation", { name: /dashboard/i })).toBeVisible();
      await expect(page.getByRole("main")).toContainText(/DriftRadar/i);
      await expect(page.locator("header").getByText(/fixture|live/i)).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await expect(page).toHaveScreenshot(`landing-${viewport.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.03
      });

      await clickNav(page, /overview/i);
      await expect(page.getByText(/drift risk/i).first()).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);

      await clickNav(page, /walkthrough/i);
      await expect(page.getByRole("heading", { name: /Replay the review/i })).toBeVisible();
      await expect(page.getByText(/Play voice/i)).toBeVisible();
      await expect(page.getByText(/Captured regression/i)).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await expect(page).toHaveScreenshot(`walkthrough-${viewport.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.03
      });

      await clickNav(page, /issues/i);
      await expect(page.getByRole("heading", { name: /Focus ring regressed|Primary focus ring/i })).toBeVisible();
      await expect(page.getByText(/suggested fix/i).first()).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
      await expect(page).toHaveScreenshot(`issues-${viewport.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.03
      });

      await clickNav(page, /export/i);
      await expect(page.getByRole("heading", { name: /review packet/i })).toBeVisible();
      await expectNoPageOverflow(page);
      await expectNoA11yViolations(page);
    }
  });

  test("keeps live API mode reachable when a backend is running", async ({ page, request }) => {
    test.skip(
      process.env.DRIFTRADAR_EXPECT_LIVE !== "1",
      "Set DRIFTRADAR_EXPECT_LIVE=1 for live API smoke."
    );

    const health = await request.get("http://localhost:4317/api/health");
    expect(health.ok()).toBe(true);
    await page.goto(dashboardUrl!);
    await expect(page.getByText(/live/i).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: /dashboard/i })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoA11yViolations(page);
  });
});

async function clickNav(page: import("@playwright/test").Page, label: RegExp): Promise<void> {
  await page.locator("a,button").filter({ hasText: label }).first().click();
}

async function expectNoPageOverflow(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoA11yViolations(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}
