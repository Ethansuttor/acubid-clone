// Installability guard. Nothing in the app fails visibly if an icon is renamed
// or regenerated at the wrong size — Edge just quietly stops offering "Install
// this site as an app", or installs with a blank tile. So assert the contract.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import manifest from "@/app/manifest";

const m = manifest();

/** Width/height out of a PNG's IHDR chunk: 8-byte signature, then 8, then w/h. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Manifest icon srcs are site-absolute; on disk they are served from public/. */
function onDisk(src: string): string {
  return join(process.cwd(), "public", src.replace(/^\//, ""));
}

describe("web app manifest", () => {
  it("carries what Edge and Chrome require to offer an install", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    // A white flash on launch, against this app's near-black UI, looks broken.
    expect(m.background_color).toBe("#0b0f14");
    expect(m.theme_color).toBe("#0b0f14");
  });

  it("declares both icon sizes Chromium wants, plus a maskable one", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("every declared icon exists at the size it claims", () => {
    expect(m.icons?.length).toBeGreaterThan(0);
    for (const icon of m.icons ?? []) {
      const file = onDisk(String(icon.src));
      expect(existsSync(file), `${icon.src} is declared but not on disk`).toBe(true);
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect(pngSize(file), `${icon.src} is not ${icon.sizes}`).toEqual({
        width: w,
        height: h,
      });
    }
  });

  it("ships the favicon Next serves from the app directory", () => {
    const icon = join(process.cwd(), "src", "app", "icon.png");
    expect(existsSync(icon)).toBe(true);
    expect(pngSize(icon).width).toBe(512);
  });
});
