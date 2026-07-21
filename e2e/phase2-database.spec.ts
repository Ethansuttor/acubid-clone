// Phase 2 verification: item database CRUD and assembly builder, with the
// per-assembly rollup checked against hand math:
//   2.85 + 0.55 + 3.10 = $6.50 material, 0.20 + 0.05 + 0.25 = 0.500 hr

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test("phase 2: items and assemblies", async ({ page }) => {
  await signIn(page);

  const name = `E2E Phase2 ${Date.now()}`;
  await page.fill('input[placeholder="New project name…"]', name);
  await page.click('button:has-text("Create project")');
  await page.waitForURL("**/project/**");
  await page.click("button.tab >> text=database");

  // Add three items
  const rows: [string, string, string, string][] = [
    ["DPLX-15", "Duplex receptacle 15A", "2.85", "0.2"],
    ["PLT-1G", "1-gang plate", "0.55", "0.05"],
    ["BOX-4S", "4in square box", "3.10", "0.25"],
  ];
  for (let i = 0; i < rows.length; i++) {
    await page.click('button:has-text("+ Item")');
    const row = page.locator("table tbody tr").nth(i);
    await row.locator('input[placeholder="code"]').fill(rows[i][0]);
    await row.locator('input[placeholder="description"]').fill(rows[i][1]);
    const nums = row.locator("input.input-num");
    await nums.nth(0).fill(rows[i][2]);
    await nums.nth(1).fill(rows[i][3]);
    await nums.nth(1).blur();
  }

  // Build an assembly from them
  await page.click('button:has-text("+ Assembly")');
  await page.locator('input[value="New assembly"]').fill("Duplex receptacle assembly");
  for (const code of ["DPLX-15", "PLT-1G", "BOX-4S"]) {
    await page.locator("select").last().selectOption({ label: `${code} — ${rows.find((r) => r[0] === code)![1]}` });
  }
  await expect(page.getByText("$6.50")).toBeVisible();
  await expect(page.getByText("0.500")).toBeVisible();

  // Persists across reload
  await page.reload();
  await page.click("button.tab >> text=database");
  await expect(page.locator('input[value="DPLX-15"]')).toBeVisible();
  await page.getByText("Duplex receptacle assembly").click();
  await expect(page.getByText("$6.50")).toBeVisible();
});
