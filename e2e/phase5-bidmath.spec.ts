// Bid-math completeness in the real UI: typical multiplier, waste, sales tax,
// labor factoring, direct job costs, and the missing-quantity warning.
//
// Hand math for this scenario (3 receptacle assemblies: DPLX $2.85/0.20hr +
// PLT $0.55/0.05hr):
//   material 3 x 3.40 = 10.20     labor 3 x 0.25 = 0.75 hr
//   waste 10%        = 1.02  -> after waste 11.22
//   sales tax 5%     = 0.561 -> material total 11.781
//   labor +20%       = 0.90 hr -> @ $100/hr = 90.00
//   switchgear quote 5000 (O&P applies), permit 500 (at cost)
//   prime = 11.781 + 90.00 + 5000 = 5101.781
//   overhead 10%  = 510.1781   subtotal = 5611.9591
//   profit 10%    = 561.19591  bid = 6173.15501 + 500 = 6673.15501 -> $6,673.16
//
// The unlinked "Unpriced devices" layer carries a count but no price, so it
// must change nothing in the bid while still being reported as an issue.

import { test, expect } from "@playwright/test";
import { signIn, clickPdf } from "./helpers";

test("bid math: typical multiplier, waste, tax, labor factor, direct costs", async ({ page }) => {
  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `E2E BidMath ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { loaded: boolean } } };
    return w.__ws?.getState().loaded;
  });
  await page.evaluate(() => {
    const ws = (window as unknown as {
      __ws: { getState(): Record<string, CallableFunction> & { userId: string } };
    }).__ws.getState();
    const u = ws.userId;
    ws.upsertItem({ id: "i-dplx", user_id: u, code: "DPLX", description: "Duplex receptacle", unit: "EA", material_cost: 2.85, labor_hours: 0.2 });
    ws.upsertItem({ id: "i-plt", user_id: u, code: "PLT", description: "1-gang plate", unit: "EA", material_cost: 0.55, labor_hours: 0.05 });
    ws.upsertAssembly({ id: "a-rec", user_id: u, code: "A-REC", name: "Duplex assembly", description: "" });
    ws.setAssemblyItems("a-rec", [
      { id: "c1", assembly_id: "a-rec", item_id: "i-dplx", user_id: u, quantity: 1 },
      { id: "c2", assembly_id: "a-rec", item_id: "i-plt", user_id: u, quantity: 1 },
    ]);
  });

  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });

  // One count layer on the assembly, 3 clicks
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "A-REC — Duplex assembly" });
  await clickPdf(page, 80, 642);
  await clickPdf(page, 80, 392);
  await clickPdf(page, 520, 642);
  await expect(page.getByText("3 EA")).toBeVisible();

  // Typical multiplier: two identical floors doubles the quantity and the money
  await page.getByTestId("layer-typical").fill("2");
  await expect(page.getByText("6 EA")).toBeVisible();
  await expect(page.getByText("×2 typical")).toBeVisible();
  await page.click("button.tab >> text=estimate");
  await expect(page.getByText("$20.40")).toBeVisible(); // 6 x 3.40

  // A layer carrying quantity with no item/assembly must be flagged, not dropped
  await page.click("button.tab >> text=takeoff");
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Unpriced devices");
  await page.click('button:has-text("Create layer")');
  await clickPdf(page, 520, 392);
  await page.click("button.tab >> text=estimate");
  const issue = page.getByTestId("estimate-issue");
  await expect(issue).toHaveCount(1);
  await expect(issue).toContainText("Unpriced devices");
  await expect(issue).toContainText("not linked");

  // Summary: markups + direct costs
  await page.click("button.tab >> text=summary");
  await expect(page.getByText(/carry quantity that is missing/)).toBeVisible();
  await page.getByTestId("labor-rate").fill("100");
  await page.getByTestId("waste-pct").fill("10");
  await page.getByTestId("tax-pct").fill("5");
  await page.getByTestId("labor-factor-pct").fill("20");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("10");

  // Back to a single typical floor for the documented bid figures.
  await page.click("button.tab >> text=takeoff");
  await page.getByText("Receptacles").click(); // make it the active layer again
  await page.getByTestId("layer-typical").fill("1");
  await expect(page.getByText("3 EA")).toBeVisible();
  await page.click("button.tab >> text=summary");

  await page.click('button:has-text("+ Cost")');
  const row1 = page.locator("table tbody tr").first();
  await row1.locator('input[placeholder^="e.g."]').fill("Switchgear quote");
  await row1.locator("input.input-num").fill("5000");
  await row1.locator("input.input-num").blur();

  await page.click('button:has-text("+ Cost")');
  const row2 = page.locator("table tbody tr").nth(1);
  await row2.locator('input[placeholder^="e.g."]').fill("Permit");
  await row2.locator("input.input-num").fill("500");
  await row2.locator("input.input-num").blur();
  const row2Ohp = row2.locator('input[type="checkbox"]').first();
  await row2Ohp.uncheck(); // carried at cost
  await expect(row2.getByText("at cost")).toBeVisible();

  await expect(page.getByTestId("bid-price")).toHaveText("$6,673.16");

  // Proof the at-cost item is not marked up: switching it on raises the bid by
  // exactly 500 x 1.10 x 1.10 - 500 = 105.00  ->  $6,778.16
  await row2Ohp.check();
  await expect(page.getByTestId("bid-price")).toHaveText("$6,778.16");

  // Everything survives a reload
  await row2Ohp.uncheck();
  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { pendingWrites: number } } };
    return w.__ws?.getState().pendingWrites === 0;
  });
  await page.reload();
  await page.click("button.tab >> text=summary");
  await expect(page.getByTestId("bid-price")).toHaveText("$6,673.16", { timeout: 30_000 });
});

// Continues the same scenario with the markups a real bid also carries.
//
//   material total (as above)                        =    11.781
//   escalation 3%       11.781 x 0.03                =     0.35343
//   labor cost @ $100/hr on 0.90 hr                  =    90.00
//   burden 30%          90 x 0.30                    =    27.00
//   small tools 2%      90 x 0.02                    =     1.80
//   labor total                                      =   118.80
//   switchgear 5000 O&P + TAXABLE, tax 5%            =   250.00  -> 5250.00
//   permit 500 at cost, no tax
//   prime  11.781 + 0.35343 + 118.80 + 5250          =  5380.93443
//   contingency 5%                                   =   269.0467215
//   cost + contingency                               =  5649.9811515
//   overhead 10%                                     =   564.99811515
//   subtotal                                         =  6214.97926665
//   profit 10%                                       =   621.497926665
//   + permit 500  -> price before bond               =  7336.477193315
//   bond 1.5% OF THE BID PRICE:
//     bid  = 7336.477193315 / 0.985                  =  7448.20019626
//     bond = 7448.20019626 x 0.015                   =   111.72300294
//   BID PRICE                                        -> $7,448.20
test("bid math: burden, small tools, escalation, contingency, taxed quote, bond", async ({
  page,
}) => {
  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `E2E Markups ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { loaded: boolean } } };
    return w.__ws?.getState().loaded;
  });
  await page.evaluate(() => {
    const ws = (window as unknown as {
      __ws: { getState(): Record<string, CallableFunction> & { userId: string } };
    }).__ws.getState();
    const u = ws.userId;
    ws.upsertItem({ id: "i-dplx", user_id: u, code: "DPLX", description: "Duplex receptacle", unit: "EA", material_cost: 2.85, labor_hours: 0.2 });
    ws.upsertItem({ id: "i-plt", user_id: u, code: "PLT", description: "1-gang plate", unit: "EA", material_cost: 0.55, labor_hours: 0.05 });
    ws.upsertAssembly({ id: "a-rec", user_id: u, code: "A-REC", name: "Duplex assembly", description: "" });
    ws.setAssemblyItems("a-rec", [
      { id: "c1", assembly_id: "a-rec", item_id: "i-dplx", user_id: u, quantity: 1 },
      { id: "c2", assembly_id: "a-rec", item_id: "i-plt", user_id: u, quantity: 1 },
    ]);
  });

  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });

  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "A-REC — Duplex assembly" });
  await clickPdf(page, 80, 642);
  await clickPdf(page, 80, 392);
  await clickPdf(page, 520, 642);
  await expect(page.getByText("3 EA")).toBeVisible();

  await page.click("button.tab >> text=summary");
  await page.getByTestId("labor-rate").fill("100");
  await page.getByTestId("waste-pct").fill("10");
  await page.getByTestId("tax-pct").fill("5");
  await page.getByTestId("labor-factor-pct").fill("20");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("10");

  // Baseline before the new markups: the figure phase 5 already proves.
  await page.click('button:has-text("+ Cost")');
  const quote = page.locator("table tbody tr").first();
  await quote.locator('input[placeholder^="e.g."]').fill("Switchgear quote");
  await quote.locator("input.input-num").fill("5000");
  await quote.locator("input.input-num").blur();

  await page.click('button:has-text("+ Cost")');
  const permit = page.locator("table tbody tr").nth(1);
  await permit.locator('input[placeholder^="e.g."]').fill("Permit");
  await permit.locator("input.input-num").fill("500");
  await permit.locator("input.input-num").blur();
  await permit.locator('input[type="checkbox"]').first().uncheck(); // at cost
  await expect(page.getByTestId("bid-price")).toHaveText("$6,673.16");

  // Sales tax on a quote: 5% of 5000 = 250, inside prime, so it picks up
  // 10% overhead and 10% profit -> 250 x 1.10 x 1.10 = 302.50 -> $6,975.66
  await quote.getByTestId("cost-taxable").check();
  await expect(quote.getByText("taxed")).toBeVisible();
  await expect(page.getByTestId("bid-price")).toHaveText("$6,975.66");

  // The rest of the markups, to the hand-calculated total above.
  await page.getByTestId("labor-burden-pct").fill("30");
  await page.getByTestId("small-tools-pct").fill("2");
  await page.getByTestId("escalation-pct").fill("3");
  await page.getByTestId("contingency-pct").fill("5");
  await expect(page.getByText("Labor burden (30% of labor cost)")).toBeVisible();
  await expect(page.getByText("Labor total")).toBeVisible();

  // A bond rate that cannot be solved must add nothing and say so out loud.
  await page.getByTestId("bond-pct").fill("150");
  await expect(page.getByTestId("summary-warning")).toContainText("not a usable percentage");
  const withoutBond = await page.getByTestId("bid-price").textContent();

  await page.getByTestId("bond-pct").fill("1.5");
  await expect(page.getByTestId("summary-warning")).toHaveCount(0);
  await expect(page.getByTestId("bid-price")).toHaveText("$7,448.20");
  expect(withoutBond).toBe("$7,336.48"); // price before the bond premium

  // Everything survives a reload
  await page.waitForFunction(() => {
    const w = window as unknown as { __ws?: { getState(): { pendingWrites: number } } };
    return w.__ws?.getState().pendingWrites === 0;
  });
  await page.reload();
  await page.click("button.tab >> text=summary");
  await expect(page.getByTestId("bid-price")).toHaveText("$7,448.20", { timeout: 30_000 });
});
