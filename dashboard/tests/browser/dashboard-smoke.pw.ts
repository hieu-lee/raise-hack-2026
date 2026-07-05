import { expect, test } from "@playwright/test";

const dashboardUrl = process.env.DRIFTRADAR_DASHBOARD_URL;

test.describe("DriftRadar dashboard smoke", () => {
  test.skip(!dashboardUrl, "Set DRIFTRADAR_DASHBOARD_URL to run browser smoke checks.");

  test("covers the fixture-mode primary flow on desktop and mobile", async ({ page }) => {
    test.skip(
      process.env.DRIFTRADAR_EXPECT_LIVE === "1",
      "Live-mode smoke skips fixture assertions."
    );

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(dashboardUrl!);
      await expect(page.getByText(/DriftRadar/i).first()).toBeVisible();
      await expect(page.getByText(/fixture/i).first()).toBeVisible();
      await expectNoPageOverflow(page);

      await clickNav(page, /overview/i);
      await expect(page.getByText(/drift score/i).first()).toBeVisible();
      await expectNoPageOverflow(page);

      await clickNav(page, /issues/i);
      await expect(page.getByText(/token misuse/i).first()).toBeVisible();
      await expect(page.getByText(/suggested fix/i).first()).toBeVisible();
      await expectNoPageOverflow(page);

      await clickNav(page, /export/i);
      await expect(page.getByText(/PR comment|markdown|export/i).first()).toBeVisible();
      await expectNoPageOverflow(page);
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
