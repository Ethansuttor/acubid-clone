"use client";

// PDF.js wrapper: loads documents from local storage and caches proxies
// per document id so sheet switching doesn't refetch or reparse.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { supabase } from "./supabase";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const cache = new Map<string, Promise<PDFDocumentProxy>>();

export type PdfOptionalContentConfig = Awaited<
  ReturnType<PDFDocumentProxy["getOptionalContentConfig"]>
>;

export interface PdfOptionalContentGroup {
  id: string;
  name: string;
  visible: boolean;
}

export interface PdfOptionalContentInspection {
  config: PdfOptionalContentConfig;
  groups: PdfOptionalContentGroup[];
}

export interface PdfPageStructure {
  operator_count: number;
  image_paint_count: number;
  text_item_count: number;
  has_searchable_text: boolean;
}

export function loadPdfFromData(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise;
}

export function loadDocument(documentId: string, storagePath: string): Promise<PDFDocumentProxy> {
  let p = cache.get(documentId);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase().storage.from("plans").download(storagePath);
      if (error || !data) throw new Error(`Failed to download plan: ${error?.message}`);
      return loadPdfFromData(await data.arrayBuffer());
    })();
    cache.set(documentId, p);
    p.catch(() => cache.delete(documentId));
  }
  return p;
}

/** Prime the cache with bytes we already have (right after upload). */
export function primeDocumentCache(documentId: string, data: ArrayBuffer) {
  cache.set(documentId, loadPdfFromData(data));
}

/** Read real PDF Optional Content Groups (the feature Acrobat labels Layers). */
export async function inspectOptionalContent(
  pdf: PDFDocumentProxy
): Promise<PdfOptionalContentInspection> {
  const config = await pdf.getOptionalContentConfig({ intent: "display" });
  const raw = (config.getGroups() ?? {}) as Record<string, { name?: string }>;
  const groups = Object.entries(raw)
    .map(([id, group]) => ({
      id,
      name: group.name?.trim() || `Layer ${id}`,
      visible: Boolean(config.isVisible({ type: "OCG", id })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { config, groups };
}

/**
 * Cheap first-pass signal for the auto-count router. Searchable text and a low
 * raster-image count suggest we should inspect vector operators before running
 * any vision model.
 */
export async function inspectPageStructure(
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>
): Promise<PdfPageStructure> {
  const [operators, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
  const imageOps = new Set([
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageMaskXObjectRepeat,
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintInlineImageXObject,
  ]);
  return {
    operator_count: operators.fnArray.length,
    image_paint_count: operators.fnArray.filter((operator) => imageOps.has(operator)).length,
    text_item_count: text.items.length,
    has_searchable_text: text.items.length > 0,
  };
}
