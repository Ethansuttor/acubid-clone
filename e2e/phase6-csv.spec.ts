// Bulk-loading the estimator's own price book, and refusing to import
// silently-broken data.

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

const ITEMS_CSV = [
  "code,description,unit,material_cost,labor_hours",
  "DPLX-15,Duplex receptacle 15A,EA,2.85,0.20",
  'PNL-42,"Panelboard, 42ct",EA,"$1,250.00",6.5',
  "BAD-1,Broken cost,EA,abc,0.1",
  "EMT-050,1/2in EMT,FT,0.68,0.032",
].join("\n");

const ASM_CSV = [
  "assembly_code,assembly_name,item_code,quantity",
  "A-REC,Duplex receptacle assembly,DPLX-15,1",
  "A-REC,Duplex receptacle assembly,EMT-050,6",
  "A-REC,Duplex receptacle assembly,NOPE-99,3",
].join("\n");

test("CSV import/export of the item and assembly database", async ({ page }) => {
  await signIn(page);
  await page.fill('input[placeholder="New project name…"]', `E2E CSV ${Date.now()}`);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");
  await page.click("button.tab >> text=database");

  // Import items: three good rows, one unreadable row reported by line
  await page.getByTestId("import-items").setInputFiles({
    name: "items.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(ITEMS_CSV),
  });
  await expect(page.getByTestId("import-ok")).toHaveText("3 item(s) added, 0 updated");
  await expect(page.getByTestId("import-error")).toHaveCount(1);
  await expect(page.getByTestId("import-error")).toContainText("Line 4");
  // quoted comma and $1,250.00 survived the round trip
  await expect(page.locator('input[value="Panelboard, 42ct"]')).toBeVisible();
  await expect(page.locator('input[value="1,250.00"]')).toBeVisible();

  // Re-importing with a changed price updates in place rather than duplicating
  await page.getByTestId("import-items").setInputFiles({
    name: "items2.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("code,description,unit,material_cost,labor_hours\nDPLX-15,Duplex receptacle 15A,EA,3.15,0.22"),
  });
  await expect(page.getByTestId("import-ok")).toHaveText("0 item(s) added, 1 updated");
  await expect(page.locator('input[value="3.15"]')).toBeVisible();
  await expect(page.getByText("Item database (3)")).toBeVisible();

  // Import assemblies with one unknown item code: the error is reported, and
  // the assembly is left unbuilt rather than persisted half-complete.
  await page.getByTestId("import-assemblies").setInputFiles({
    name: "asm.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(ASM_CSV),
  });
  await expect(page.getByTestId("import-ok")).toHaveText("1 assembly(s) added, 0 updated");
  await expect(page.getByTestId("import-error")).toContainText("NOPE-99");
  await page.getByText("Duplex receptacle assembly").click();
  await expect(page.getByText("Per assembly:")).toContainText("$0.00");

  // Fix the file and re-import: now the components are applied.
  await page.getByTestId("import-assemblies").setInputFiles({
    name: "asm2.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(ASM_CSV.split("\n").filter((l) => !l.includes("NOPE-99")).join("\n")),
  });
  await expect(page.getByTestId("import-ok")).toHaveText("0 assembly(s) added, 1 updated");
  await expect(page.getByTestId("import-error")).toHaveCount(0);
  // DPLX-15 was repriced to 3.15/0.22 by the second item import, so the
  // assembly rolls up 3.15 + 6 x 0.68 = 7.23 material, 0.22 + 6 x 0.032 = 0.412 hr
  await expect(page.getByText("$7.23")).toBeVisible();
  await expect(page.getByText("0.412")).toBeVisible();

  // Export downloads a CSV that survives a reload
  const dl = page.waitForEvent("download");
  await page.click('button:has-text("↓ Items CSV")');
  const file = await dl;
  expect(file.suggestedFilename()).toBe("voltline-items.csv");

  await page.reload();
  await page.click("button.tab >> text=database");
  await expect(page.getByText("Item database (3)")).toBeVisible({ timeout: 30_000 });
});
