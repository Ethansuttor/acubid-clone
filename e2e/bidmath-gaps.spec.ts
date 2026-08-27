// E2E for the bid-math gap knobs: tax on direct costs, contingency, and the
// circular bond — driven through the real UI, asserted against hand math.
//
// Scenario (no takeoff; everything from one taxable O&P quote):
//   quote 10,000 (O&P applies, taxable) @ tax 10%  -> tax 1,000
//   prime      = 11,000
//   contingency 5%                                 = 550
//   overhead 10% on (prime + contingency)          = 1,155
//   subtotal   = 12,705
//   profit 10%                                     = 1,270.50
//   preBond    = 13,975.50
//   bond 2% of the FINAL price: bid = 13,975.50 / 0.98 = 14,260.7142857...
//   -> displayed $14,260.71; bond line = bid - preBond = 285.2142857 -> $285.21

import { expect, test } from "@playwright/test";
import { expectPreflightBlocker, expectPreflightReady } from "./helpers";

test("taxable quote, contingency and circular bond price through the UI", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.fill('input[placeholder="New project name…"]', `Bid gaps ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/project\//);

  await page.click("button.tab >> text=summary");

  // One direct cost: switchgear quote, O&P applies (default), tax added.
  await page.click('button:has-text("+ Cost")');
  const row = page.locator("table tbody tr").first();
  await row.locator('input[placeholder^="e.g."]').fill("Switchgear quote");
  await row.locator("input.input-num").fill("10000");
  await row.locator("input.input-num").blur();
  await row.getByTestId("direct-cost-taxable").check();
  await expect(row.getByText("tax added")).toBeVisible();

  // Commercial knobs.
  await page.getByTestId("tax-pct").fill("10");
  await page.getByTestId("contingency-pct").fill("5");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("10");
  await page.getByTestId("bond-pct").fill("2");
  await page.getByTestId("bond-pct").blur();

  // Hand-calculated result and the intermediate lines that produce it.
  await expect(page.getByTestId("bid-price")).toHaveText("$14,260.71");
  await expect(page.getByText("Tax on direct costs (10%, O&P applies)")).toBeVisible();
  await expect(page.getByText("$1,000.00")).toBeVisible();
  await expect(page.getByText("Contingency (5%)")).toBeVisible();
  await expect(page.getByText("$550.00")).toBeVisible();
  await expect(page.getByText("Bond (2%)")).toBeVisible();
  await expect(page.getByText("$285.21")).toBeVisible();
  await expectPreflightReady(page);

  // Bond >= 100% has no finite bid; preflight must refuse, not clamp.
  await page.getByTestId("bond-pct").fill("100");
  await page.getByTestId("bond-pct").blur();
  await expectPreflightBlocker(page, "invalid-commercial-input");

  // Back to a sane bond: ready again at the same price.
  await page.getByTestId("bond-pct").fill("2");
  await page.getByTestId("bond-pct").blur();
  await expect(page.getByTestId("bid-price")).toHaveText("$14,260.71");
  await expectPreflightReady(page);

  // Tax off again: the whole tax line disappears from the bid.
  //   prime 10,000 -> cont 500 -> oh 1,050 -> sub 11,550 -> profit 1,155
  //   preBond 12,705 -> /0.98 = 12,964.2857... -> $12,964.29
  await row.getByTestId("direct-cost-taxable").uncheck();
  await expect(page.getByTestId("bid-price")).toHaveText("$12,964.29");
});
