import { expect, test } from "@playwright/test";
import {
  createBidSnapshot,
  expectPreflightBlocker,
  expectPreflightReady,
  expectRevision,
} from "./helpers";

test("local access creates a project and preserves guarded bid revisions", async ({ page }) => {
  await page.goto("/login");

  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toHaveValue("1");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

  const name = `Local project ${Date.now()}`;
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "takeoff" })).toBeVisible();

  // Navigate to summary and verify initial preflight blocker on empty bid
  await page.getByRole("button", { name: "summary" }).click();
  await expectPreflightBlocker(page, "empty-bid");
  await expect(page.getByText("The bid has no priced scope")).toBeVisible();

  // 1. Add direct cost ($100) and create Revision 1 ($100)
  await page.getByRole("button", { name: "+ Cost" }).click();
  await page.getByLabel("Description for direct cost new cost").fill("Permit allowance");
  const amount1 = page.getByLabel("Amount for Permit allowance");
  await amount1.fill("100");
  await amount1.blur();
  await expect(page.getByTestId("bid-price")).toHaveText("$100.00");
  await expectPreflightReady(page);

  await createBidSnapshot(page, "Base bid");
  await expectRevision(page, 1, "$100.00", "Base bid");

  // 2. Add second direct cost ($150) and create Revision 2 ($250)
  await page.getByRole("button", { name: "+ Cost" }).click();
  await page.getByLabel("Description for direct cost new cost").fill("Equipment rental");
  const amount2 = page.getByLabel("Amount for Equipment rental");
  await amount2.fill("150");
  await amount2.blur();
  await expect(page.getByTestId("bid-price")).toHaveText("$250.00");
  await expectPreflightReady(page);

  await createBidSnapshot(page, "Addendum 1");
  await expectRevision(page, 2, "$250.00", "Addendum 1");

  // 3. Add third direct cost ($50) and create Revision 3 ($300)
  await page.getByRole("button", { name: "+ Cost" }).click();
  await page.getByLabel("Description for direct cost new cost").fill("Bond package");
  const amount3 = page.getByLabel("Amount for Bond package");
  await amount3.fill("50");
  await amount3.blur();
  await expect(page.getByTestId("bid-price")).toHaveText("$300.00");
  await expectPreflightReady(page);

  await createBidSnapshot(page, "Addendum 2");
  await expectRevision(page, 3, "$300.00", "Addendum 2");

  // 4. Snapshot immutability: all three revisions display simultaneously with frozen values
  await expectRevision(page, 1, "$100.00", "Base bid");
  await expectRevision(page, 2, "$250.00", "Addendum 1");
  await expectRevision(page, 3, "$300.00", "Addendum 2");

  // 5. Snapshot persistence across reload
  await page.reload();
  await page.getByRole("button", { name: "summary" }).click();
  await expectRevision(page, 1, "$100.00", "Base bid");
  await expectRevision(page, 2, "$250.00", "Addendum 1");
  await expectRevision(page, 3, "$300.00", "Addendum 2");

  // 6. Preflight blocker enforcement: clearing description blocks snapshot creation
  await page.getByLabel("Description for direct cost Permit allowance").fill("");
  await expectPreflightBlocker(page, "unnamed-direct-cost");
  await expect(page.getByText("A direct cost has no description")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resolve blockers to export" })).toBeDisabled();
  await expect(page.getByTestId("create-snapshot-btn")).toBeDisabled();

  // Restoring description unblocks snapshot creation
  await page.getByLabel("Description for direct cost new cost").fill("Permit allowance");
  await expectPreflightReady(page);
  await expect(page.getByTestId("create-snapshot-btn")).toBeEnabled();
});
