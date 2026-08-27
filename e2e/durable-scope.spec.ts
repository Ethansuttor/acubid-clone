import { expect, test } from "@playwright/test";
import { signIn, waitSaved } from "./helpers";

test("durable IndexedDB outbox preserves proposal scope across reload", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await signIn(page);
  const name = `Durable scope ${Date.now()}`;
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/project\//);

  await page.getByRole("button", { name: "scope" }).click();
  await expect(page.getByRole("heading", { name: "Scope and proposal" })).toBeVisible();

  await page.getByRole("button", { name: "Add inclusion" }).click();
  await page.getByLabel("inclusion description").fill("Branch wiring shown on E-series drawings");
  await page.getByLabel("inclusion pricing note").fill("Base bid scope");

  await page.getByRole("button", { name: /allowances/i }).click();
  await page.getByRole("button", { name: "Add allowance" }).click();
  await page.getByLabel("allowance description").fill("Permit allowance");
  const amount = page.getByLabel("allowance amount");
  await amount.fill("2500");
  await amount.blur();
  await waitSaved(page);

  await expect(page.getByText("Permit allowance", { exact: true })).toBeVisible();
  await expect(page.getByText("$2,500.00", { exact: true })).toBeVisible();

  const durableStores = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("voltline-local-v1", 1);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction("journal", "readonly");
    const count = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore("journal").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { stores: [...db.objectStoreNames], journalCount: count };
  });
  expect(durableStores.stores).toEqual(expect.arrayContaining(["state", "files", "journal", "meta"]));
  expect(durableStores.journalCount).toBeGreaterThanOrEqual(3);

  await page.reload();
  await page.getByRole("button", { name: "scope" }).click();
  await page.getByRole("button", { name: /allowances/i }).click();
  await expect(page.getByLabel("allowance description")).toHaveValue("Permit allowance");
  await expect(page.getByLabel("allowance amount")).toHaveValue("2,500.00");
  expect(runtimeErrors).toEqual([]);
});
