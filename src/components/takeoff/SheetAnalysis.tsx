"use client";

// AI sheet analysis: reads each sheet's title block and drawing scale, then
// proposes a name and a calibration. Nothing is applied until the estimator
// confirms — a scale read from a plot-to-fit PDF would mis-measure the whole
// sheet, so the proposal always shows what it read and what it derived.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadDocument } from "@/lib/pdf";
import { calibrationFromScale, feetPerUnit, formatScale } from "@/lib/sheetai/scale";
import { useWorkspace } from "@/store/workspace";
import type { Sheet } from "@/lib/types";

interface Proposal {
  id: string;
  sheetNumber: string | null;
  sheetTitle: string | null;
  scaleText: string | null;
  feetPerInch: number | null;
  confidence: number;
  error?: string;
}

const LONG_EDGE_PX = 2000;

export default function SheetAnalysis() {
  const ws = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  async function run() {
    if (ws.sheets.length === 0) return;
    setBusy("Rendering sheets…");
    setError(null);
    setApplied(new Set());
    try {
      const images: { id: string; image: string }[] = [];
      for (const sheet of ws.sheets) {
        const doc = ws.documents.find((d) => d.id === sheet.document_id);
        if (!doc) continue;
        const pdf = await loadDocument(doc.id, doc.storage_path);
        const page = await pdf.getPage(sheet.page_number);
        const base = page.getViewport({ scale: 1 });
        const scale = LONG_EDGE_PX / Math.max(base.width, base.height);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        images.push({ id: sheet.id, image: canvas.toDataURL("image/png") });
      }

      setBusy(`Reading ${images.length} title block(s)…`);
      const { data: sess } = await supabase().auth.getSession();
      const res = await fetch("/api/sheetinfo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ sheets: images }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `Sheet analysis failed (HTTP ${res.status})`);
      }
      const result = (await res.json()) as { proposals: Proposal[] };
      setProposals(result.proposals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function apply(p: Proposal) {
    const sheet = ws.sheets.find((s) => s.id === p.id);
    if (!sheet) return;
    const name = proposedName(p);
    if (name) ws.renameSheet(sheet.id, name);
    if (p.feetPerInch) {
      ws.setCalibration(
        sheet.id,
        calibrationFromScale(p.feetPerInch),
        feetPerUnit(p.feetPerInch)
      );
    }
    setApplied((s) => new Set(s).add(p.id));
  }

  const usable = (proposals ?? []).filter((p) => proposedName(p) || p.feetPerInch);

  return (
    <>
      <button
        className="btn !px-2 !py-0.5 text-xs !text-[var(--color-ai)]"
        onClick={run}
        disabled={!!busy || ws.sheets.length === 0}
        title="Read title blocks and drawing scales with Claude"
      >
        {busy ? "…" : "✨ Read"}
      </button>

      {(busy || error || proposals) && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-analysis-title"
        >
          <div className="panel max-h-full w-[720px] overflow-auto">
            <div className="titlebar flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3 !text-[var(--color-ai)]">
              <span id="sheet-analysis-title" className="font-semibold">AI sheet analysis</span>
              <button
                className="btn !px-2 !py-0.5 text-xs"
                onClick={() => {
                  setProposals(null);
                  setError(null);
                }}
                disabled={!!busy}
              >
                Close
              </button>
            </div>

            {busy && (
              <div className="px-4 py-6 text-sm text-[var(--color-fg-dim)]" role="status" aria-live="polite">
                {busy}
              </div>
            )}
            {error && (
              <div className="px-4 py-6 text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </div>
            )}

            {proposals && !busy && (
              <>
                <div className="border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-fg-dim)]">
                  Scales are derived from the printed scale text and assume the PDF was
                  plotted at true size. Spot-check one known dimension before taking off.
                </div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Sheet</th>
                      <th>Proposed name</th>
                      <th>Scale read</th>
                      <th>Calibration</th>
                      <th className="r w-24">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p) => {
                      const sheet = ws.sheets.find((s) => s.id === p.id);
                      const name = proposedName(p);
                      const done = applied.has(p.id);
                      return (
                        <tr key={p.id} data-testid="sheet-proposal">
                          <td className="text-[var(--color-fg-dim)]">
                            {sheet?.name ?? "?"}
                          </td>
                          <td>{name ?? <span className="text-[var(--color-fg-faint)]">—</span>}</td>
                          <td className="font-mono text-xs">
                            {p.scaleText ?? <span className="text-[var(--color-fg-faint)]">none</span>}
                          </td>
                          <td className="num text-xs">
                            {p.feetPerInch ? (
                              <span className="text-[var(--color-ok)]">
                                {formatScale(p.feetPerInch)}
                              </span>
                            ) : (
                              <span className="text-[var(--color-fg-faint)]">
                                {p.error ? "failed" : "not usable"}
                              </span>
                            )}
                          </td>
                          <td className="r">
                            {done ? (
                              <span className="text-xs text-[var(--color-ok)]">applied</span>
                            ) : (
                              <button
                                className="btn !px-2 !py-0.5 text-xs"
                                disabled={!name && !p.feetPerInch}
                                onClick={() => apply(p)}
                              >
                                Apply
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-[var(--color-line)] px-4 py-3">
                  <span className="text-xs text-[var(--color-fg-faint)]">
                    Applying a scale is undoable with Ctrl+Z.
                  </span>
                  <button
                    className="btn btn-volt"
                    disabled={usable.every((p) => applied.has(p.id))}
                    onClick={() => usable.forEach(apply)}
                  >
                    Apply all ({usable.filter((p) => !applied.has(p.id)).length})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function proposedName(p: Proposal): string | null {
  const parts = [p.sheetNumber, p.sheetTitle].filter(Boolean);
  return parts.length > 0 ? parts.join("  ") : null;
}

export type { Sheet };
