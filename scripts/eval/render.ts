// Offline page rendering for the detection evaluation harness.
//
// The application renders with pdf.js onto a browser canvas (SymbolSearch.tsx).
// Offline we use the same pdf.js package (legacy Node build, same version) and
// @napi-rs/canvas, the canvas backend pdf.js itself loads in Node. Differences
// from the application that the harness relies on being harmless are tested in
// tests/eval-render.test.ts; the ones it cannot remove are listed in
// RENDERER_DIFFERENCES and printed with every report.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import type { PageBox } from "./manifest";

const require = createRequire(import.meta.url);

export const RENDERER_DIFFERENCES = [
  "Offline rasterizer is @napi-rs/canvas (Skia) driven by pdfjs-dist's Node build; the app uses the same pdf.js version on a Chromium canvas. Antialiasing can differ by small pixel amounts.",
  "Non-embedded standard fonts: the harness loads pdf.js's bundled Foxit standard font data (without it pdf.js draws no text in Node); the app, which sets no standardFontDataUrl, lets the browser substitute a system font. Text-shaped symbols (for example the 'S' switch) therefore have different glyph outlines than on a user's machine.",
] as const;

export interface RendererInfo {
  name: "pdfjs-dist+@napi-rs/canvas";
  pdfjsVersion: string;
  canvasVersion: string;
  standardFonts: "pdfjs-dist/standard_fonts";
}

function packageVersion(name: string): string {
  const pkgPath = require.resolve(`${name}/package.json`);
  return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
}

export function rendererInfo(): RendererInfo {
  return {
    name: "pdfjs-dist+@napi-rs/canvas",
    pdfjsVersion: packageVersion("pdfjs-dist"),
    canvasVersion: packageVersion("@napi-rs/canvas"),
    standardFonts: "pdfjs-dist/standard_fonts",
  };
}

/**
 * Render scale chosen by SymbolSearch.tsx for an example box drawn in PDF
 * units. Copied, not imported: the formula is inline in the component. The
 * drift test in tests/eval-render.test.ts pins this copy to the component
 * source until the formula is exported from a pure module (patch request).
 */
export function symbolSearchRenderScale(box: { w: number; h: number }, page: { width: number; height: number }): number {
  let scale = Math.min(4, Math.max(1.5, 72 / Math.max(box.w, box.h)));
  scale = Math.min(scale, Math.sqrt(32e6 / (page.width * page.height)));
  return scale;
}

/** Template crop rectangle computed by SymbolSearch.tsx before cropCanvas(). */
export function symbolSearchTemplateRect(box: PageBox, scale: number, canvas: { width: number; height: number }): PageBox {
  const pad = 0.1 * Math.max(box.w, box.h) * scale;
  const x = Math.max(0, box.x * scale - pad), y = Math.max(0, box.y * scale - pad);
  const right = Math.min(canvas.width, (box.x + box.w) * scale + pad);
  const bottom = Math.min(canvas.height, (box.y + box.h) * scale + pad);
  return { x, y, w: right - x, h: bottom - y };
}

// pdfjs-dist ships its Node-compatible build under legacy/. Typed loosely: the
// harness uses only getDocument/getPage/getViewport/render.
interface PdfViewport { width: number; height: number }
interface PdfPage {
  rotate: number;
  view: number[];
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvasContext: unknown; viewport: PdfViewport }): { promise: Promise<void> };
  cleanup(): void;
}
interface PdfDocument { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }
interface PdfJs { getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> } }

let pdfjsPromise: Promise<PdfJs> | undefined;
function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")) as Promise<PdfJs>;
  return pdfjsPromise;
}

/** The manifest asked for a page the PDF does not have: an input error, not a detector failure. */
export class PageRangeError extends Error {
  constructor(page: number, pages: number) {
    super(`Page ${page} is out of range; the PDF has ${pages} page(s).`);
    this.name = "PageRangeError";
  }
}

export interface RenderedPage {
  canvas: Canvas;
  scale: number;
  /** Page size in PDF units at scale 1 (pdf.js viewport; top-left origin, y down). */
  pageWidth: number;
  pageHeight: number;
  rotation: number;
  renderMs: number;
}

export interface RenderRequest {
  pdfBytes: Uint8Array;
  page: number;
  /** A number, or a function of the page size at scale 1 (the app's policy). */
  scale: number | ((page: { width: number; height: number }) => number);
}

/** Renders exactly as SymbolSearch.tsx does: floor(viewport) canvas, pdf.js default white background. */
export async function renderPage({ pdfBytes, page: pageNumber, scale }: RenderRequest): Promise<RenderedPage> {
  const pdfjs = await loadPdfjs();
  const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;
  // pdf.js detaches the buffer it is given; pass a copy so callers keep theirs.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0, standardFontDataUrl }).promise;
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new PageRangeError(pageNumber, doc.numPages);
    const page = await doc.getPage(pageNumber);
    const vp1 = page.getViewport({ scale: 1 });
    const chosen = typeof scale === "number" ? scale : scale({ width: vp1.width, height: vp1.height });
    if (!Number.isFinite(chosen) || chosen <= 0) throw new Error(`Invalid render scale ${chosen}.`);
    const viewport = page.getViewport({ scale: chosen });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const started = performance.now();
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const renderMs = performance.now() - started;
    page.cleanup();
    return { canvas, scale: chosen, pageWidth: vp1.width, pageHeight: vp1.height, rotation: page.rotate, renderMs };
  } finally {
    await doc.destroy();
  }
}

/**
 * Minimal `document` for pipeline.ts cropCanvas(): createElement("canvas")
 * returns a Skia canvas whose width/height/getContext/drawImage behave like the
 * browser's for the unscaled pixel copy the local-only path performs.
 */
export function installCanvasDocument(): { restore(): void } {
  const globals = globalThis as { document?: unknown };
  const previous = globals.document;
  globals.document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`Evaluation document cannot create <${tag}>.`);
      return createCanvas(1, 1);
    },
  };
  return {
    restore() {
      if (previous === undefined) delete globals.document;
      else globals.document = previous;
    },
  };
}
