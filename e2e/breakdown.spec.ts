// Bid breakdown by system/area/phase in the real UI (roadmap B-302).
//
// Scenario, hand-calculated:
//   Item LTG  $100.00 material, 0 labor  -> layer "Fixtures",    system "Lighting"
//   Item PWR  $300.00 material, 0 labor  -> layer "Receptacles", system "Power"
//   One click on each layer. No waste, tax, escalation or profit; overhead 10%.
//
//   prime    = 100 + 300 = 400
//   overhead = 40        -> bid 440
//   Power    share = 300 + 30 = 330  = 75.0% of the bid
//   Lighting share = 100 + 10 = 110  = 25.0% of the bid
//   330 + 110 = 440, so the rows must sum to the bid price shown above them.
//
// Nothing is tagged on "area", so switching dimension must move the whole bid
// into "Unassigned" rather than dropping it.

import { test, expect } from "@playwright/test";
import { signIn, clickPdf } from "./helpers";

test("bid breakdown groups the bid by layer tag and reconciles to the total", async ({
  page,
}) => {
  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `E2E Breakdown ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { loaded: boolean } } };
    return w.__ws?.getState().loaded;
  });
  await page.evaluate(() => {
    const ws = (
      window as unknown as {
        __ws: { getState(): Record<string, CallableFunction> & { userId: string } };
      }
    ).__ws.getState();
    const u = ws.userId;
    ws.upsertItem({ id: "i-ltg", user_id: u, code: "LTG", description: "Troffer", unit: "EA", material_cost: 100, labor_hours: 0 });
    ws.upsertItem({ id: "i-pwr", user_id: u, code: "PWR", description: "Panelboard", unit: "EA", material_cost: 300, labor_hours: 0 });
  });

  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as
      | { pageW: number }
      | undefined;
    return !!v && v.pageW > 0;
  });

  // Layer 1: fixtures, tagged as the Lighting system.
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Fixtures");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "LTG — Troffer" });
  await page.getByLabel("system for layer Fixtures").fill("Lighting");
  await clickPdf(page, 80, 642);

  // Layer 2: receptacles, tagged as the Power system.
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "PWR — Panelboard" });
  await page.getByLabel("system for layer Receptacles").fill("Power");
  await clickPdf(page, 520, 642);

  await page.click("button.tab >> text=summary");
  await page.getByTestId("waste-pct").fill("0");
  await page.getByTestId("tax-pct").fill("0");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("0");
  await expect(page.getByTestId("bid-price")).toHaveText("$440.00");

  const breakdown = page.getByTestId("bid-breakdown");
  await expect(breakdown).toBeVisible();
  await expect(breakdown.getByTestId("breakdown-mismatch")).toHaveCount(0);

  // Highest-value system first, and each row carries its share of the bid.
  const rows = breakdown.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Power");
  await expect(rows.nth(0)).toContainText("$330.00");
  await expect(rows.nth(0)).toContainText("75.0%");
  await expect(rows.nth(1)).toContainText("Lighting");
  await expect(rows.nth(1)).toContainText("$110.00");
  await expect(rows.nth(1)).toContainText("25.0%");
  // The parts sum to the bid price shown above the table.
  await expect(breakdown.locator("tfoot")).toContainText("$440.00");

  // Nothing is tagged by area: the money must move to Unassigned, not vanish.
  await breakdown.getByRole("button", { name: "Area" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("Unassigned");
  await expect(rows.nth(0)).toContainText("$440.00");
  await expect(breakdown).toContainText("no area assigned");

  await breakdown.getByRole("button", { name: "System" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Power");
});
