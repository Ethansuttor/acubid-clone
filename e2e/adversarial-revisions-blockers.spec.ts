import { expect, test } from "@playwright/test";
import {
  createBidSnapshot,
  expectPreflightBlocker,
  expectPreflightReady,
  expectRevision,
  signIn,
} from "./helpers";

test("adversarial e2e: multi-revision incrementing, immutability, reload persistence, and preflight blocker enforcement", async ({
  page,
}) => {
  await signIn(page);

  const projectName = `Adv Revision Project ${Date.now()}`;
  await page.fill('input[placeholder="New project name…"]', projectName);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  // 1. Initial State: Empty Bid -> Preflight Blocker "empty-bid"
  await page.click("button.tab >> text=summary");
  await expectPreflightBlocker(page, "empty-bid");
  await expect(page.getByTestId("create-snapshot-btn")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve blockers to export" })).toBeDisabled();

  // 2. Add Direct Cost 1 -> $100.00
  await page.click('button:has-text("+ Cost")');
  await page.getByLabel("Description for direct cost new cost").fill("Initial Scope");
  const amt1 = page.getByLabel("Amount for Initial Scope");
  await amt1.fill("100");
  await amt1.blur();

  await expect(page.getByTestId("bid-price")).toHaveText("$100.00");
  await expectPreflightReady(page);
  await expect(page.getByTestId("create-snapshot-btn")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export to Excel" })).toBeEnabled();

  // Lock R1
  await createBidSnapshot(page, "Rev 1 - Base Scope");
  await expectRevision(page, 1, "$100.00", "Rev 1 - Base Scope");

  // 3. Add Direct Cost 2 -> $250.00 total
  await page.click('button:has-text("+ Cost")');
  await page.getByLabel("Description for direct cost new cost").fill("Addendum 1 - Feeders");
  const amt2 = page.getByLabel("Amount for Addendum 1 - Feeders");
  await amt2.fill("150");
  await amt2.blur();

  await expect(page.getByTestId("bid-price")).toHaveText("$250.00");
  await expectPreflightReady(page);

  // Lock R2 (with blank label, defaults to "Bid revision 2")
  await createBidSnapshot(page, "");
  await expectRevision(page, 2, "$250.00", "Bid revision 2");

  // 4. Add Direct Cost 3 -> $500.00 total
  await page.click('button:has-text("+ Cost")');
  await page.getByLabel("Description for direct cost new cost").fill("Addendum 2 - Lighting & Controls (100% Final)");
  const amt3 = page.getByLabel("Amount for Addendum 2 - Lighting & Controls (100% Final)");
  await amt3.fill("250");
  await amt3.blur();

  await expect(page.getByTestId("bid-price")).toHaveText("$500.00");
  await expectPreflightReady(page);

  // Lock R3
  await createBidSnapshot(page, "Addendum 2 - Final");
  await expectRevision(page, 3, "$500.00", "Addendum 2 - Final");

  // 5. Add Direct Cost 4 -> $550.00 total
  await page.click('button:has-text("+ Cost")');
  await page.getByLabel("Description for direct cost new cost").fill("Post-Bid VE Deduction");
  const amt4 = page.getByLabel("Amount for Post-Bid VE Deduction");
  await amt4.fill("50");
  await amt4.blur();

  await expect(page.getByTestId("bid-price")).toHaveText("$550.00");
  await expectPreflightReady(page);

  // Lock R4
  await createBidSnapshot(page, "VE Option 1");
  await expectRevision(page, 4, "$550.00", "VE Option 1");

  // 6. Test Immutability: Mutate working markups (e.g. overhead & profit)
  await page.getByTestId("overhead-pct").fill("20");
  await page.getByTestId("profit-pct").fill("20");
  // Working bid price changes, but all existing 4 snapshots retain exact frozen values
  await expect(page.getByTestId("bid-price")).not.toHaveText("$550.00");
  await expectRevision(page, 1, "$100.00", "Rev 1 - Base Scope");
  await expectRevision(page, 2, "$250.00", "Bid revision 2");
  await expectRevision(page, 3, "$500.00", "Addendum 2 - Final");
  await expectRevision(page, 4, "$550.00", "VE Option 1");

  // 7. Full Reload Persistence
  await page.reload();
  await page.click("button.tab >> text=summary");

  // Verify all 4 revisions persist in full fidelity
  await expectRevision(page, 1, "$100.00", "Rev 1 - Base Scope");
  await expectRevision(page, 2, "$250.00", "Bid revision 2");
  await expectRevision(page, 3, "$500.00", "Addendum 2 - Final");
  await expectRevision(page, 4, "$550.00", "VE Option 1");

  // 8. Create R5 after reload -> revision increments to 5
  await createBidSnapshot(page, "Post-Reload Rev 5");
  await expectRevision(page, 5, undefined, "Post-Reload Rev 5");

  // 9. Systematic Preflight Blocker Enforcement in UI:
  // Blocker A: Unnamed direct cost
  await page.getByLabel("Description for direct cost Post-Bid VE Deduction").fill("");
  await expectPreflightBlocker(page, "unnamed-direct-cost");
  await expect(page.getByTestId("create-snapshot-btn")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resolve blockers to export" })).toBeDisabled();

  // Restore description -> Unblocks
  await page.getByLabel("Description for direct cost new cost").fill("Post-Bid VE Deduction");
  await expectPreflightReady(page);
  await expect(page.getByTestId("create-snapshot-btn")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export to Excel" })).toBeEnabled();
});
