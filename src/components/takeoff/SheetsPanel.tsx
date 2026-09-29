"use client";

// Plan set upload + sheet list. Uploading a PDF stores it in local
// storage, creates document + sheet rows, and primes the PDF cache.

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadPdfFromData, primeDocumentCache } from "@/lib/pdf";
import { useWorkspace } from "@/store/workspace";
import SheetAnalysis from "./SheetAnalysis";
import type { PlanDocument, Sheet } from "@/lib/types";

export default function SheetsPanel() {
  const ws = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    if (!ws.project || !ws.userId) return;
    setUploading(true);
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      // Parse first so a bad file never reaches storage. Copy the buffer:
      // pdf.js transfers it to the worker, detaching the original.
      const pdf = await loadPdfFromData(bytes.slice(0));
      const docId = crypto.randomUUID();
      const path = `${ws.userId}/${docId}.pdf`;
      const { error: upErr } = await supabase()
        .storage.from("plans")
        .upload(path, bytes, { contentType: "application/pdf" });
      if (upErr) throw new Error(upErr.message);

      const doc: PlanDocument = {
        id: docId,
        project_id: ws.project.id,
        user_id: ws.userId,
        filename: file.name,
        storage_path: path,
        page_count: pdf.numPages,
      };
      const sheets: Sheet[] = Array.from({ length: pdf.numPages }, (_, i) => ({
        id: crypto.randomUUID(),
        document_id: docId,
        project_id: ws.project!.id,
        user_id: ws.userId!,
        page_number: i + 1,
        name: `${file.name.replace(/\.pdf$/i, "")} p${i + 1}`,
        scale_ft_per_unit: null,
        calibration: null,
      }));
      const db = supabase();
      const { error: docErr } = await db.from("documents").insert(doc);
      if (docErr) {
        await db.storage.from("plans").remove([path]);
        throw new Error(docErr.message);
      }
      const { error: shErr } = await db.from("sheets").insert(sheets);
      if (shErr) {
        // Deleting the document cascades any partially inserted sheets and
        // removes the uploaded local plan bytes.
        await db.from("documents").delete().eq("id", docId);
        throw new Error(shErr.message);
      }
      primeDocumentCache(docId, bytes.slice(0));
      ws.addDocumentWithSheets(doc, sheets);
      ws.setActiveSheet(sheets[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar flex items-center justify-between gap-1 px-3 py-2">
        <span>Sheets</span>
        <div className="flex gap-1">
          <SheetAnalysis />
          <button
            className="btn !px-2 !py-0.5 text-xs"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "…" : "+ PDF"}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {error && <div className="px-3 py-1 text-xs text-[var(--color-danger)]">{error}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {ws.sheets.map((s) => (
          <button
            key={s.id}
            onClick={() => ws.setActiveSheet(s.id)}
            className={`block w-full cursor-pointer border-l-2 px-3 py-2 text-left text-[13px] ${
              s.id === ws.activeSheetId
                ? "border-[var(--color-volt)] bg-[var(--color-ink-800)] text-[var(--color-fg)]"
                : "border-transparent text-[var(--color-fg-dim)] hover:bg-[var(--color-ink-850)]"
            }`}
          >
            <div className="truncate">{s.name || `Page ${s.page_number}`}</div>
            <div className="num text-[10px] text-[var(--color-fg-faint)]">
              {s.scale_ft_per_unit != null ? "calibrated" : "not calibrated"}
            </div>
          </button>
        ))}
        {ws.sheets.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--color-fg-faint)]">
            No sheets yet. Upload a plan set PDF.
          </div>
        )}
      </div>
    </div>
  );
}
