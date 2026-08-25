// Phase 3 verification: takeoff-to-estimate linkage, live summary, Excel export.
//
// Hand math for this scenario:
//   Items: DPLX $2.85/0.20hr EA, PLT $0.55/0.05hr EA, W12 $0.18/0.008hr FT
//   Assembly A-REC = 1 DPLX + 1 PLT
//   Takeoff: 3 receptacle clicks (assembly), one 200-unit wire run at
//   0.1 ft/unit = 20 FT (item W12)
//   Material: 3(2.85+0.55) + 20(0.18)      = 10.20 + 3.60 = 13.80
//   Labor:    3(0.20+0.05) + 20(0.008)     = 0.75 + 0.16  = 0.91 hr
//   At $100/hr, 10% OH, 10% profit:
//     labor 91.00, prime 104.80, OH 10.48, subtotal 115.28,
//     profit 11.528, bid 126.808 -> $126.81
//   Profit changed to 20%: 115.28 * 1.20 = 138.336 -> $138.34

import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { signIn, clickPdf } from "./helpers";

test("phase 3: estimate extension, live summary, excel export", async ({ page }) => {
  await signIn(page);
  const name = `E2E Phase3 ${Date.now()}`;
  await page.fill('input[placeholder="New project name…"]', name);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");

  // Seed the item/assembly database through the store (UI CRUD covered in phase 2)
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
    ws.upsertItem({ id: "i-w12", user_id: u, code: "W12", description: "#12 THHN", unit: "FT", material_cost: 0.18, labor_hours: 0.008 });
    ws.upsertAssembly({ id: "a-rec", user_id: u, code: "A-REC", name: "Duplex assembly", description: "" });
    ws.setAssemblyItems("a-rec", [
      { id: "c1", assembly_id: "a-rec", item_id: "i-dplx", user_id: u, quantity: 1 },
      { id: "c2", assembly_id: "a-rec", item_id: "i-plt", user_id: u, quantity: 1 },
    ]);
  });

  // Upload + calibrate (200 units = 20 ft)
  await page.setInputFiles('input[type="file"]', "e2e/fixtures/sample-plan.pdf");
  await page.waitForFunction(() => {
    const v = (window as never as Record<string, never>)["__voltview"] as unknown as { pageW: number } | undefined;
    return !!v && v.pageW > 0;
  });
  await page.keyboard.press("k");
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.fill('input[placeholder^="e.g."]', "20");
  await page.click('button:has-text("Set scale")');

  // Receptacle layer linked to the assembly; 3 clicks
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Receptacles");
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "A-REC — Duplex assembly" });
  await clickPdf(page, 80, 642);
  await clickPdf(page, 80, 392);
  await clickPdf(page, 520, 642);
  await expect(page.getByText("3 EA")).toBeVisible();

  // Wire layer linked to the W12 item; one 200-unit run = 20 FT
  await page.click('button:has-text("+ Layer")');
  await page.fill('input[placeholder^="Layer name"]', "Ltg wire");
  await page.getByRole("button", { name: "linear", exact: true }).click();
  await page.click('button:has-text("Create layer")');
  await page.locator("select").first().selectOption({ label: "W12 — #12 THHN" });
  await clickPdf(page, 100, 732);
  await clickPdf(page, 300, 732);
  await page.keyboard.press("Enter");
  await expect(page.getByText("20 FT")).toBeVisible();

  // Estimate tab shows the extended totals
  await page.click("button.tab >> text=estimate");
  await expect(page.getByText("$13.80")).toBeVisible();
  await expect(page.getByText("0.91 hr")).toBeVisible();
  // assembly expanded to component lines
  await expect(page.getByText("Duplex receptacle").first()).toBeVisible();
  await expect(page.getByText("1-gang plate").first()).toBeVisible();

  // Summary: enter markups, check live bid
  await page.click("button.tab >> text=summary");
  await page.getByTestId("labor-rate").fill("100");
  await page.getByTestId("overhead-pct").fill("10");
  await page.getByTestId("profit-pct").fill("10");
  await expect(page.getByTestId("bid-price")).toHaveText("$126.81");

  // Live recalculation on profit change
  await page.getByTestId("profit-pct").fill("20");
  await expect(page.getByTestId("bid-price")).toHaveText("$138.34");
  await page.getByTestId("profit-pct").fill("10");

  // Excel export: capture the download and verify the Summary sheet
  const downloadPromise = page.waitForEvent("download");
  await page.click('button:has-text("Export to Excel")');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_estimate\.xlsx$/);
  const path = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path!);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Takeoff", "Material", "Labor", "Summary"]);
  const sum = wb.getWorksheet("Summary")!;
  let bid: unknown, material: unknown;
  sum.eachRow((row) => {
    const k = String(row.getCell(1).value ?? "");
    if (k.startsWith("BID PRICE")) bid = row.getCell(2).value;
    if (k.startsWith("Material total")) material = row.getCell(2).value;
  });
  expect(material).toBe(13.8);
  expect(bid).toBe(126.81);
});
