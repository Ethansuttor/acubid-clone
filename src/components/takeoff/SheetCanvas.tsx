"use client";

// The takeoff drawing surface: PDF page render + SVG overlay with all
// takeoff markers, zoom/pan, tool interactions, calibration, and editing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Layers3 } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import {
  inspectOptionalContent,
  inspectPageStructure,
  loadDocument,
  type PdfOptionalContentInspection,
  type PdfPageStructure,
} from "@/lib/pdf";
import { scaleFromCalibration, polylineLength, polygonArea } from "@/lib/geometry";
import { parseDistanceFt, formatFtIn, fmt } from "@/lib/units";
import { useWorkspace } from "@/store/workspace";
import type { PathGeometry, Takeoff } from "@/lib/types";

type Pt = [number, number];
export interface AiBoxRect { x: number; y: number; w: number; h: number }

interface Drag {
  mode: "pan" | "marker" | "vertex" | "path" | "aibox";
  takeoffId?: string;
  vertexIndex?: number;
  startPdf: Pt;
  startPan: { x: number; y: number };
  origGeometry?: Takeoff["geometry"];
  moved: boolean;
}

export default function SheetCanvas({ onAiBox }: { onAiBox?: (rect: AiBoxRect) => void }) {
  const ws = useWorkspace();
  const sheet = ws.sheets.find((s) => s.id === ws.activeSheetId) ?? null;
  const doc = ws.documents.find((d) => d.id === sheet?.document_id) ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);

  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [aiBox, setAiBox] = useState<AiBoxRect | null>(null);
  const [calibAsk, setCalibAsk] = useState<{ p1: Pt; p2: Pt } | null>(null);
  const [calibText, setCalibText] = useState("");
  const [calibErr, setCalibErr] = useState(false);
  const [dragOverride, setDragOverride] = useState<Map<string, Takeoff["geometry"]>>(new Map());
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pdfLayers, setPdfLayers] = useState<PdfOptionalContentInspection | null>(null);
  const [pdfLayerMenu, setPdfLayerMenu] = useState(false);
  const [pdfLayerVersion, setPdfLayerVersion] = useState(0);
  const [pdfStructure, setPdfStructure] = useState<PdfPageStructure | null>(null);

  const zoom = view.zoom;

  // ---- page loading ------------------------------------------------------
  useEffect(() => {
    // State resets on sheet change come from the remount (TakeoffView keys
    // this component by sheet id), so the effect only loads the page.
    let dead = false;
    pageRef.current = null;
    if (!sheet || !doc) return;
    (async () => {
      try {
        const pdf: PDFDocumentProxy = await loadDocument(doc.id, doc.storage_path);
        const page = await pdf.getPage(sheet.page_number);
        const [optionalContent, structure] = await Promise.all([
          inspectOptionalContent(pdf).catch(() => null),
          inspectPageStructure(page).catch(() => null),
        ]);
        if (dead) return;
        pageRef.current = page;
        setPdfLayers(optionalContent);
        setPdfStructure(structure);
        const vp = page.getViewport({ scale: 1 });
        setPageSize({ w: vp.width, h: vp.height });
        // Fit page into container.
        const el = containerRef.current;
        if (el) {
          const fit = Math.min(el.clientWidth / vp.width, el.clientHeight / vp.height) * 0.96;
          setView({
            zoom: fit,
            panX: (el.clientWidth - vp.width * fit) / 2,
            panY: (el.clientHeight - vp.height * fit) / 2,
          });
        }
      } catch (e) {
        if (!dead) setRenderError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [sheet?.id, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- rasterize on zoom change -----------------------------------------
  useEffect(() => {
    const page = pageRef.current;
    const canvas = canvasRef.current;
    if (!page || !canvas || !pageSize) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const renderScale = Math.min(Math.max(zoom * dpr, 0.5), 6);
    const vp = page.getViewport({ scale: renderScale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    renderTaskRef.current?.cancel();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = page.render({
      canvasContext: ctx,
      viewport: vp,
      optionalContentConfigPromise: pdfLayers
        ? Promise.resolve(pdfLayers.config)
        : undefined,
    });
    renderTaskRef.current = task;
    task.promise.catch(() => {}); // cancellations are expected
  }, [pageSize, zoom, sheet?.id, pdfLayers, pdfLayerVersion]);

  function togglePdfLayer(id: string) {
    setPdfLayers((current) => {
      if (!current) return current;
      const group = current.groups.find((item) => item.id === id);
      if (!group) return current;
      const visible = !group.visible;
      current.config.setVisibility(id, visible, true);
      return {
        ...current,
        groups: current.groups.map((item) => (item.id === id ? { ...item, visible } : item)),
      };
    });
    setPdfLayerVersion((version) => version + 1);
  }

  // Expose the current view transform for E2E tests.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    (window as unknown as Record<string, unknown>).__voltview = {
      zoom: view.zoom,
      panX: view.panX,
      panY: view.panY,
      pageW: pageSize?.w ?? 0,
      pageH: pageSize?.h ?? 0,
      left: rect.left,
      top: rect.top,
    };
  }, [view, pageSize]);

  // ---- coordinate helpers ------------------------------------------------
  const toPdf = useCallback(
    (clientX: number, clientY: number): Pt => {
      const rect = containerRef.current!.getBoundingClientRect();
      return [
        (clientX - rect.left - view.panX) / view.zoom,
        (clientY - rect.top - view.panY) / view.zoom,
      ];
    },
    [view]
  );

  // ---- wheel zoom ---------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView((v) => {
        const nz = Math.min(16, Math.max(0.05, v.zoom * Math.exp(-e.deltaY * 0.0016)));
        const k = nz / v.zoom;
        return { zoom: nz, panX: cx - (cx - v.panX) * k, panY: cy - (cy - v.panY) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // re-attach when the container first mounts (no sheet -> sheet)
  }, [sheet?.id]);

  // ---- space = pan --------------------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ---- draft finishing (Enter / Escape / right-click) ---------------------
  const finishDraft = useCallback(() => {
    if (!sheet) return;
    const layer = ws.layers.find((l) => l.id === ws.activeLayerId);
    if (layer) {
      if (ws.tool === "linear" && draft.length >= 2) {
        ws.addTakeoffs([newTakeoff(sheet.id, sheet.project_id, ws.userId!, layer.id, "linear", { points: draft })]);
      } else if (ws.tool === "area" && draft.length >= 3) {
        ws.addTakeoffs([newTakeoff(sheet.id, sheet.project_id, ws.userId!, layer.id, "area", { points: draft })]);
      }
    }
    setDraft([]);
  }, [sheet, ws, draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter") {
        finishDraft();
      } else if (e.key === "Escape") {
        setDraft([]);
        setAiBox(null);
        setCalibAsk(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft]);

  // ---- pointer handling ----------------------------------------------------
  function onPointerDown(e: React.PointerEvent) {
    if (!sheet || !pageSize) return;
    const isPan = e.button === 1 || spaceRef.current || ws.tool === "select" ? e.button === 1 || spaceRef.current : false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const pdf = toPdf(e.clientX, e.clientY);

    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { mode: "pan", startPdf: pdf, startPan: { x: view.panX, y: view.panY }, moved: false };
      return;
    }
    if (e.button === 2) {
      // right-click finishes the current path
      finishDraft();
      return;
    }
    if (e.button !== 0) return;
    void isPan;

    const layer = ws.layers.find((l) => l.id === ws.activeLayerId);
    switch (ws.tool) {
      case "count": {
        if (!layer) return;
        if (layer.tool !== "count") return;
        ws.addTakeoffs([
          newTakeoff(sheet.id, sheet.project_id, ws.userId!, layer.id, "count", { x: pdf[0], y: pdf[1] }),
        ]);
        break;
      }
      case "linear":
      case "area": {
        if (!layer || layer.tool !== ws.tool) return;
        if (e.detail >= 2) {
          finishDraft();
        } else {
          setDraft((p) => [...p, pdf]);
        }
        break;
      }
      case "calibrate": {
        setDraft((p) => {
          const pts = [...p, pdf];
          if (pts.length === 2) {
            setCalibAsk({ p1: pts[0], p2: pts[1] });
            setCalibText("");
            setCalibErr(false);
            return [];
          }
          return pts;
        });
        break;
      }
      case "aibox": {
        dragRef.current = { mode: "aibox", startPdf: pdf, startPan: { x: view.panX, y: view.panY }, moved: false };
        setAiBox({ x: pdf[0], y: pdf[1], w: 0, h: 0 });
        break;
      }
      case "select": {
        // click on empty space clears selection (markers stopPropagation)
        ws.setSelection(new Set());
        dragRef.current = { mode: "pan", startPdf: pdf, startPan: { x: view.panX, y: view.panY }, moved: false };
        break;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const pdf = toPdf(e.clientX, e.clientY);
    setCursor(pdf);
    const drag = dragRef.current;
    if (!drag) return;
    drag.moved = true;
    // pan is handled in onPointerMoveCapture from client-pixel deltas
    if (drag.mode === "aibox") {
      setAiBox({
        x: Math.min(drag.startPdf[0], pdf[0]),
        y: Math.min(drag.startPdf[1], pdf[1]),
        w: Math.abs(pdf[0] - drag.startPdf[0]),
        h: Math.abs(pdf[1] - drag.startPdf[1]),
      });
    } else if (drag.takeoffId && drag.origGeometry) {
      const dx = pdf[0] - drag.startPdf[0];
      const dy = pdf[1] - drag.startPdf[1];
      const orig = drag.origGeometry;
      let next: Takeoff["geometry"];
      if (drag.mode === "marker") {
        const o = orig as { x: number; y: number };
        next = { x: o.x + dx, y: o.y + dy };
      } else if (drag.mode === "vertex") {
        const o = orig as PathGeometry;
        next = {
          points: o.points.map((p, i) =>
            i === drag.vertexIndex ? ([p[0] + dx, p[1] + dy] as Pt) : p
          ),
        };
      } else {
        const o = orig as PathGeometry;
        next = { points: o.points.map((p) => [p[0] + dx, p[1] + dy] as Pt) };
      }
      setDragOverride(new Map([[drag.takeoffId, next]]));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === "aibox") {
      const box = aiBox;
      setAiBox(null);
      if (box && box.w > 4 && box.h > 4 && onAiBox) onAiBox(box);
      return;
    }
    if ((drag.mode === "marker" || drag.mode === "vertex" || drag.mode === "path") && drag.takeoffId) {
      const override = dragOverride.get(drag.takeoffId);
      setDragOverride(new Map());
      if (override && drag.moved) {
        const t = ws.takeoffs.find((x) => x.id === drag.takeoffId);
        if (t) ws.updateTakeoffs([{ ...t, geometry: override }]);
      }
    }
    void e;
  }

  // Fix pan math: use client-based deltas instead (replace pan handling)
  // (kept simple: pan while dragging recalculates from client movement)
  const panClientRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  function onPointerDownCapture(e: React.PointerEvent) {
    panClientRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  }
  function onPointerMoveCapture(e: React.PointerEvent) {
    const drag = dragRef.current;
    const start = panClientRef.current;
    if (drag?.mode === "pan" && start) {
      setView((v) => ({
        ...v,
        panX: start.panX + (e.clientX - start.x),
        panY: start.panY + (e.clientY - start.y),
      }));
    }
  }

  // ---- marker interactions -------------------------------------------------
  function markerPointerDown(e: React.PointerEvent, t: Takeoff, vertexIndex?: number) {
    if (ws.tool !== "select") return; // tools draw over markers
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const sel = new Set(e.shiftKey ? [...ws.selection] : []);
    sel.add(t.id);
    ws.setSelection(sel);
    const pdf = toPdf(e.clientX, e.clientY);
    dragRef.current = {
      mode: t.kind === "count" ? "marker" : vertexIndex != null ? "vertex" : "path",
      takeoffId: t.id,
      vertexIndex,
      startPdf: pdf,
      startPan: { x: view.panX, y: view.panY },
      origGeometry: t.geometry,
      moved: false,
    };
  }

  // ---- calibration commit ---------------------------------------------------
  function commitCalibration() {
    if (!calibAsk || !sheet) return;
    const ft = parseDistanceFt(calibText);
    if (!ft) {
      setCalibErr(true);
      return;
    }
    const calibration = { p1: calibAsk.p1, p2: calibAsk.p2, distance_ft: ft };
    ws.setCalibration(sheet.id, calibration, scaleFromCalibration(calibration));
    setCalibAsk(null);
    ws.setTool("select");
  }

  // ---- derived render data --------------------------------------------------
  const layerById = useMemo(() => new Map(ws.layers.map((l) => [l.id, l])), [ws.layers]);
  const sheetTakeoffs = useMemo(
    () => ws.takeoffs.filter((t) => t.sheet_id === sheet?.id && t.status !== "rejected"),
    [ws.takeoffs, sheet?.id]
  );
  const scale = sheet?.scale_ft_per_unit ?? null;

  if (!sheet) {
    return (
      <div className="blueprint flex h-full items-center justify-center text-[var(--color-fg-dim)]">
        Upload a plan set to begin takeoff.
      </div>
    );
  }

  const mk = (n: number) => n / zoom; // constant screen-size helper

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={containerRef}
        className={`blueprint h-full w-full touch-none select-none ${
          ws.tool === "select" ? "cursor-select" : "cursor-count"
        }`}
        onPointerDown={(e) => {
          onPointerDownCapture(e);
          onPointerDown(e);
        }}
        onPointerMove={(e) => {
          onPointerMoveCapture(e);
          onPointerMove(e);
        }}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {pdfLayers && pdfLayers.groups.length > 0 && (
          <div className="absolute right-3 top-3 z-20" onPointerDown={(event) => event.stopPropagation()}>
            <button
              className="btn bg-[var(--color-ink-900)] text-xs"
              type="button"
              aria-expanded={pdfLayerMenu}
              onClick={() => setPdfLayerMenu((open) => !open)}
            >
              <Layers3 size={14} /> PDF layers ({pdfLayers.groups.length})
            </button>
            {pdfLayerMenu && (
              <div className="panel mt-2 max-h-72 w-72 overflow-auto p-2 shadow-2xl">
                <div className="titlebar mb-2 px-1">Embedded drawing layers</div>
                {pdfLayers.groups.map((group) => (
                  <button
                    key={group.id}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--color-ink-800)]"
                    type="button"
                    aria-pressed={group.visible}
                    onClick={() => togglePdfLayer(group.id)}
                  >
                    {group.visible ? <Eye size={13} className="text-[var(--color-volt)]" /> : <EyeOff size={13} className="text-[var(--color-fg-faint)]" />}
                    <span className="truncate">{group.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {pageSize && (
          <div
            className="absolute"
            style={{
              left: view.panX,
              top: view.panY,
              width: pageSize.w * zoom,
              height: pageSize.h * zoom,
            }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 h-full w-full bg-white shadow-[0_0_40px_rgba(0,0,0,0.6)]"
            />
            <svg
              className="absolute inset-0 h-full w-full overflow-visible"
              viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
              preserveAspectRatio="none"
            >
              {/* takeoff markers */}
              {sheetTakeoffs.map((t) => {
                const layer = layerById.get(t.layer_id);
                if (!layer) return null;
                const geometry = dragOverride.get(t.id) ?? t.geometry;
                const selected = ws.selection.has(t.id);
                const pending = t.status === "pending";
                const color = pending ? "var(--color-pending)" : layer.color;
                if (t.kind === "count") {
                  const g = geometry as { x: number; y: number };
                  return (
                    <g
                      key={t.id}
                      transform={`translate(${g.x} ${g.y})`}
                      onPointerDown={(e) => markerPointerDown(e, t)}
                      style={{ cursor: ws.tool === "select" ? "move" : undefined }}
                    >
                      <circle
                        r={mk(8)}
                        fill={color}
                        fillOpacity={pending ? 0.4 : 0.85}
                        stroke={selected ? "#fff" : "#0b0f14"}
                        strokeWidth={mk(selected ? 2.5 : 1.2)}
                        strokeDasharray={pending ? `${mk(3)} ${mk(2)}` : undefined}
                      />
                      <circle r={mk(1.6)} fill="#0b0f14" />
                    </g>
                  );
                }
                const g = geometry as PathGeometry;
                const ptsStr = g.points.map((p) => p.join(",")).join(" ");
                const isArea = t.kind === "area";
                const label =
                  scale != null
                    ? isArea
                      ? `${fmt(polygonArea(g.points) * scale * scale, 0)} SF`
                      : formatFtIn(polylineLength(g.points) * scale)
                    : "";
                const mid = g.points[Math.floor(g.points.length / 2)];
                return (
                  <g key={t.id}>
                    {isArea ? (
                      <polygon
                        points={ptsStr}
                        fill={color}
                        fillOpacity={pending ? 0.12 : 0.22}
                        stroke={selected ? "#fff" : color}
                        strokeWidth={mk(selected ? 3 : 2)}
                        strokeDasharray={pending ? `${mk(5)} ${mk(3)}` : undefined}
                        onPointerDown={(e) => markerPointerDown(e, t)}
                        style={{ cursor: ws.tool === "select" ? "move" : undefined }}
                      />
                    ) : (
                      <polyline
                        points={ptsStr}
                        fill="none"
                        stroke={selected ? "#fff" : color}
                        strokeWidth={mk(selected ? 3.5 : 2.5)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray={pending ? `${mk(6)} ${mk(3)}` : undefined}
                        onPointerDown={(e) => markerPointerDown(e, t)}
                        style={{ cursor: ws.tool === "select" ? "move" : undefined }}
                      />
                    )}
                    {selected &&
                      g.points.map((p, i) => (
                        <circle
                          key={i}
                          cx={p[0]}
                          cy={p[1]}
                          r={mk(4.5)}
                          fill="#fff"
                          stroke={color}
                          strokeWidth={mk(1.5)}
                          onPointerDown={(e) => markerPointerDown(e, t, i)}
                          style={{ cursor: "grab" }}
                        />
                      ))}
                    {label && mid && (
                      <text
                        x={mid[0]}
                        y={mid[1] - mk(6)}
                        fontSize={mk(11)}
                        fontFamily="var(--font-mono)"
                        fill={color}
                        stroke="#0b0f14"
                        strokeWidth={mk(2.5)}
                        paintOrder="stroke"
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* draft path */}
              {draft.length > 0 && (
                <g pointerEvents="none">
                  <polyline
                    points={[...draft, ...(cursor ? [cursor] : [])].map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={ws.tool === "calibrate" ? "var(--color-pending)" : "var(--color-volt)"}
                    strokeWidth={mk(2)}
                    strokeDasharray={`${mk(6)} ${mk(4)}`}
                  />
                  {draft.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r={mk(3.5)} fill="var(--color-volt)" />
                  ))}
                  {ws.tool === "linear" && scale != null && cursor && draft.length >= 1 && (
                    <text
                      x={cursor[0] + mk(14)}
                      y={cursor[1] - mk(10)}
                      fontSize={mk(12)}
                      fontFamily="var(--font-mono)"
                      fill="var(--color-volt)"
                      stroke="#0b0f14"
                      strokeWidth={mk(3)}
                      paintOrder="stroke"
                    >
                      {formatFtIn(polylineLength([...draft, cursor]) * scale)}
                    </text>
                  )}
                </g>
              )}

              {/* AI selection box */}
              {aiBox && (
                <rect
                  x={aiBox.x}
                  y={aiBox.y}
                  width={aiBox.w}
                  height={aiBox.h}
                  fill="var(--color-pending)"
                  fillOpacity={0.12}
                  stroke="var(--color-pending)"
                  strokeWidth={mk(1.5)}
                  strokeDasharray={`${mk(5)} ${mk(3)}`}
                  pointerEvents="none"
                />
              )}
            </svg>
          </div>
        )}
        {renderError && (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--color-danger)]">
            {renderError}
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="panel absolute bottom-0 left-0 right-0 flex items-center gap-5 border-x-0 border-b-0 px-3 py-1.5 text-xs">
        <span className="num text-[var(--color-fg-dim)]">{Math.round(zoom * 100)}%</span>
        {scale != null ? (
          <span className="num text-[var(--color-ok)]">
            CAL 1&quot;={fmt(scale * 72, 1)}&apos;
          </span>
        ) : (
          <span className="font-mono text-[var(--color-danger)]">UNCALIBRATED · press K</span>
        )}
        {ws.tool === "calibrate" && (
          <span className="text-[var(--color-pending)]">
            Calibration: click two points a known distance apart{draft.length === 1 ? " (1 of 2)" : ""}
          </span>
        )}
        {(ws.tool === "linear" || ws.tool === "area") && (
          <span className="text-[var(--color-fg-dim)]">
            Click vertices · <span className="kbd">Enter</span>/double-click to finish ·{" "}
            <span className="kbd">Esc</span> cancels
          </span>
        )}
        {ws.tool === "aibox" && (
          <span className="text-[var(--color-pending)]">Drag a box around ONE example symbol</span>
        )}
        {pdfStructure && (
          <span className="text-[var(--color-fg-faint)]" title={`${pdfStructure.operator_count} PDF drawing operators; ${pdfStructure.text_item_count} text items; ${pdfStructure.image_paint_count} raster images`}>
            {pdfLayers?.groups.length
              ? `${pdfLayers.groups.length} PDF layers`
              : pdfStructure.has_searchable_text
              ? "PDF text/vector data"
              : "Flattened/raster PDF"}
          </span>
        )}
        <span className="ml-auto num text-[var(--color-fg-faint)]">
          {cursor && scale != null
            ? `${fmt(cursor[0] * scale, 1)}, ${fmt(cursor[1] * scale, 1)} ft`
            : ""}
        </span>
      </div>

      {/* calibration distance dialog */}
      {calibAsk && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calib-title"
        >
          <div className="panel w-[320px] p-5">
            <div id="calib-title" className="titlebar mb-3">Calibrate sheet scale</div>
            <label htmlFor="calib-input" className="mb-2 block text-sm text-[var(--color-fg-dim)]">
              Real-world distance between the two points:
            </label>
            <input
              autoFocus
              id="calib-input"
              aria-label="Real-world distance"
              className="input input-num mb-1"
              placeholder={`e.g. 25' 6"`}
              value={calibText}
              onChange={(e) => setCalibText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCalibration();
                if (e.key === "Escape") setCalibAsk(null);
              }}
            />
            {calibErr && (
              <div className="mb-2 text-xs text-[var(--color-danger)]" role="alert">
                Enter a distance like 25, 25.5, or 25&apos; 6&quot;
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" onClick={() => setCalibAsk(null)}>
                Cancel
              </button>
              <button className="btn btn-volt" onClick={commitCalibration}>
                Set scale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function newTakeoff(
  sheetId: string,
  projectId: string,
  userId: string,
  layerId: string,
  kind: Takeoff["kind"],
  geometry: Takeoff["geometry"]
): Takeoff {
  return {
    id: crypto.randomUUID(),
    layer_id: layerId,
    sheet_id: sheetId,
    project_id: projectId,
    user_id: userId,
    kind,
    geometry,
    source: "manual",
    status: "confirmed",
    ai_confidence: null,
  };
}
