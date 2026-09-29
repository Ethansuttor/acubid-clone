// Equivalences the offline evaluation relies on where it cannot run the
// application's own browser renderer:
//  - SymbolSearch's render-scale, canvas-size and template-crop formulas are
//    copied into scripts/eval/render.ts (pinned here against the component);
//  - both offline renderers (pdf.js + @napi-rs/canvas for eval:detection,
//    pypdfium2 for the legacy eval:local) map PDF points to pixels with the
//    same top-left, y-down convention the manifests use;
//  - production cropCanvas, given the harness's canvas document, copies the
//    template pixels exactly.
// Pixel-level antialiasing and system-font substitution are NOT covered; they
// are listed as known differences in every report.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { cropCanvas } from "@/lib/autocount/pipeline";
import { installCanvasDocument, renderPage, symbolSearchRenderScale, symbolSearchTemplateRect } from "../scripts/eval/render";

const ROOT = path.resolve(__dirname, "..");

describe("SymbolSearch formulas copied into the harness", () => {
  const source = readFileSync(path.join(ROOT, "src/components/takeoff/SymbolSearch.tsx"), "utf8");
  it.each([
    "let scale = Math.min(4, Math.max(1.5, 72 / Math.max(request.w, request.h)));",
    "scale = Math.min(scale, Math.sqrt(32e6 / (vp1.width * vp1.height)));",
    "canvas.width = Math.floor(viewport.width);",
    "canvas.height = Math.floor(viewport.height);",
    "const pad = 0.1 * Math.max(request.w, request.h) * scale;",
    "const x = Math.max(0, request.x * scale - pad), y = Math.max(0, request.y * scale - pad);",
    "const right = Math.min(canvas.width, (request.x + request.w) * scale + pad);",
    "const bottom = Math.min(canvas.height, (request.y + request.h) * scale + pad);",
    "const template = cropCanvas(canvas, x, y, right - x, bottom - y);",
    "const sheetDetections = mapDetectionsToSheet(result.detections, { x: 0, y: 0 }, scale);",
  ])("component still contains: %s", line => {
    // If this fails, SymbolSearch changed: update scripts/eval/render.ts to match
    // (or, better, export the formula from a pure module and import it in both).
    expect(source).toContain(line);
  });

  it("computes the same scales SymbolSearch would for the fixtures", () => {
    const archD = { width: 2592, height: 1728 }, letter = { width: 612, height: 792 };
    expect(symbolSearchRenderScale({ w: 72, h: 36 }, archD)).toBe(1.5);
    // Small symbols on ARCH D hit the 32-megapixel cap, not the 4× ceiling the legacy script used.
    expect(symbolSearchRenderScale({ w: 14, h: 22 }, archD)).toBeCloseTo(Math.sqrt(32e6 / (2592 * 1728)), 12);
    expect(symbolSearchRenderScale({ w: 16, h: 16 }, archD)).toBeCloseTo(2.6729, 4);
    expect(symbolSearchRenderScale({ w: 28, h: 28 }, letter)).toBeCloseTo(72 / 28, 12);
    expect(symbolSearchTemplateRect({ x: 0.5, y: 10, w: 10, h: 5 }, 2, { width: 100, height: 100 })).toEqual({ x: 0, y: 18, w: 23, h: 14 });
  });
});

async function markerPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  // Bottom-left PDF coordinates (50, 20) size 30 × 10 => top-left box (50, 70, 30, 10).
  page.drawRectangle({ x: 50, y: 20, width: 30, height: 10, color: rgb(0, 0, 0) });
  return doc.save();
}

function darkBBox(data: Uint8ClampedArray | Uint8Array, width: number, height: number) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4] < 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

describe("offline renderer coordinate convention", () => {
  it.each([3, 2.5])("pdf.js in Node maps PDF points to top-left pixels at scale %s", async scale => {
    const rendered = await renderPage({ pdfBytes: await markerPdf(), page: 1, scale });
    expect([rendered.canvas.width, rendered.canvas.height]).toEqual([Math.floor(200 * scale), Math.floor(100 * scale)]);
    expect([rendered.pageWidth, rendered.pageHeight, rendered.rotation]).toEqual([200, 100, 0]);
    const { data } = rendered.canvas.getContext("2d").getImageData(0, 0, rendered.canvas.width, rendered.canvas.height);
    expect(data[3]).toBe(255); // opaque white paper, as pdf.js paints in the browser
    const box = darkBBox(data, rendered.canvas.width, rendered.canvas.height);
    for (const [actual, expected] of [[box.x0, 50 * scale], [box.y0, 70 * scale], [box.x1, 80 * scale], [box.y1, 80 * scale]]) {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
    }
  });

  it("the legacy pypdfium2 renderer uses the same convention", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "voltline-render-"));
    const file = path.join(dir, "marker.pdf");
    writeFileSync(file, await markerPdf());
    const code = [
      "import json, sys, pypdfium2 as pdfium",
      "from PIL import ImageOps",
      "img = pdfium.PdfDocument(sys.argv[1])[0].render(scale=3).to_pil().convert('L')",
      "print(json.dumps({'size': img.size, 'bbox': ImageOps.invert(img).point(lambda v: 255 if v > 127 else 0).getbbox()}))",
    ].join("\n");
    const out = JSON.parse(execFileSync("python", ["-c", code, file], { encoding: "utf8" }));
    expect(out.size).toEqual([600, 300]);
    const [x0, y0, x1, y1] = out.bbox;
    for (const [actual, expected] of [[x0, 150], [y0, 210], [x1, 240], [y1, 240]]) expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  });

  it("rejects a page that does not exist", async () => {
    await expect(renderPage({ pdfBytes: await markerPdf(), page: 2, scale: 1 })).rejects.toThrow(/out of range; the PDF has 1 page/);
  });
});

describe("production cropCanvas on the harness canvas", () => {
  it("copies the template pixels exactly for a fractional crop rectangle", async () => {
    const { canvas } = await renderPage({ pdfBytes: await markerPdf(), page: 1, scale: 3 });
    const shim = installCanvasDocument();
    try {
      const rect = { x: 140.6, y: 199.2, w: 110.3, h: 51.7 };
      const template = cropCanvas(canvas as unknown as HTMLCanvasElement, rect.x, rect.y, rect.w, rect.h) as unknown as typeof canvas;
      // cropCanvas floors the origin and ceils the size.
      expect([template.width, template.height]).toEqual([111, 52]);
      const copied = template.getContext("2d").getImageData(0, 0, 111, 52).data;
      const source = canvas.getContext("2d").getImageData(140, 199, 111, 52).data;
      expect(Buffer.from(copied).equals(Buffer.from(source))).toBe(true);
    } finally {
      shim.restore();
    }
  });
});
