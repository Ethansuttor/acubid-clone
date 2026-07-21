"use client";

// PDF.js wrapper: loads documents from Supabase storage and caches proxies
// per document id so sheet switching doesn't refetch or reparse.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { supabase } from "./supabase";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const cache = new Map<string, Promise<PDFDocumentProxy>>();

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
