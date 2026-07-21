"use client";

// Color-coded takeoff layers: create, select, link to item/assembly,
// set rise/drop, and see live quantities.

import { useState } from "react";
import { useWorkspace } from "@/store/workspace";
import { layerQuantities } from "@/lib/estimate";
import { fmtQty } from "@/lib/units";
import type { Layer, Tool } from "@/lib/types";

const PALETTE = [
  "#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7",
  "#ec4899", "#14b8a6", "#eab308", "#f97316", "#84cc16",
];

const UNIT: Record<Tool, string> = { count: "EA", linear: "FT", area: "SF" };

export default function LayersPanel() {
  const ws = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [tool, setTool] = useState<Tool>("count");

  const quantities = layerQuantities(ws.layers, ws.takeoffs, ws.sheets);

  function addLayer() {
    if (!name.trim() || !ws.project || !ws.userId) return;
    const layer: Layer = {
      id: crypto.randomUUID(),
      project_id: ws.project.id,
      user_id: ws.userId,
      name: name.trim(),
      color: PALETTE[ws.layers.length % PALETTE.length],
      tool,
      item_id: null,
      assembly_id: null,
      rise_drop_ft: 0,
      sort_order: ws.layers.length,
    };
    ws.addLayer(layer);
    ws.setTool(tool);
    setName("");
    setAdding(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="titlebar flex items-center justify-between px-3 py-2">
        <span>Layers</span>
        <button className="btn !px-2 !py-0.5 text-xs" onClick={() => setAdding((a) => !a)}>
          + Layer
        </button>
      </div>

      {adding && (
        <div className="border-b border-[var(--color-line)] p-3">
          <input
            autoFocus
            className="input mb-2"
            placeholder="Layer name (e.g. Duplex receptacles)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLayer()}
          />
          <div className="mb-2 flex gap-1">
            {(["count", "linear", "area"] as Tool[]).map((t) => (
              <button
                key={t}
                className={`btn flex-1 justify-center !px-1 text-xs ${
                  tool === t ? "!border-[var(--color-volt)] !text-[var(--color-volt)]" : ""
                }`}
                onClick={() => setTool(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button className="btn btn-volt w-full justify-center" onClick={addLayer}>
            Create layer
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {quantities.map(({ layer, quantity, objects, needsCalibration }) => {
          const active = layer.id === ws.activeLayerId;
          const linked =
            (layer.item_id && ws.items.find((i) => i.id === layer.item_id)?.description) ||
            (layer.assembly_id && ws.assemblies.find((a) => a.id === layer.assembly_id)?.name) ||
            null;
          return (
            <div
              key={layer.id}
              onClick={() => {
                ws.setActiveLayer(layer.id);
                if (ws.tool !== "select") ws.setTool(layer.tool);
              }}
              className={`cursor-pointer border-l-2 px-3 py-2 ${
                active
                  ? "border-[var(--color-volt)] bg-[var(--color-ink-800)]"
                  : "border-transparent hover:bg-[var(--color-ink-850)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: layer.color }}
                />
                <span className="min-w-0 flex-1 truncate text-[13px]">{layer.name}</span>
                <span className="num text-xs text-[var(--color-volt)]">
                  {fmtQty(quantity)} {UNIT[layer.tool]}
                </span>
              </div>
              <div className="ml-5 flex items-center gap-2 text-[10.5px] text-[var(--color-fg-faint)]">
                <span>{objects} obj</span>
                {layer.tool === "linear" && layer.rise_drop_ft > 0 && (
                  <span>+{layer.rise_drop_ft}′/run</span>
                )}
                {needsCalibration && (
                  <span className="text-[var(--color-danger)]">needs calibration</span>
                )}
                <span className="truncate">{linked ?? "unlinked"}</span>
              </div>
              {active && <LayerEditor layer={layer} />}
            </div>
          );
        })}
        {ws.layers.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--color-fg-faint)]">
            Create a layer to start counting. Each layer is tied to an item or assembly and
            feeds the estimate.
          </div>
        )}
      </div>
    </div>
  );
}

function LayerEditor({ layer }: { layer: Layer }) {
  const ws = useWorkspace();
  const link = layer.item_id ? `i:${layer.item_id}` : layer.assembly_id ? `a:${layer.assembly_id}` : "";
  return (
    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      <select
        className="input text-xs"
        value={link}
        onChange={(e) => {
          const v = e.target.value;
          ws.updateLayer(layer.id, {
            item_id: v.startsWith("i:") ? v.slice(2) : null,
            assembly_id: v.startsWith("a:") ? v.slice(2) : null,
          });
        }}
      >
        <option value="">— link to item/assembly —</option>
        {ws.assemblies.length > 0 && (
          <optgroup label="Assemblies">
            {ws.assemblies.map((a) => (
              <option key={a.id} value={`a:${a.id}`}>
                {a.code ? `${a.code} — ` : ""}{a.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Items">
          {ws.items.map((i) => (
            <option key={i.id} value={`i:${i.id}`}>
              {i.code ? `${i.code} — ` : ""}{i.description}
            </option>
          ))}
        </optgroup>
      </select>
      <div className="flex items-center gap-2">
        {layer.tool === "linear" && (
          <label className="flex flex-1 items-center gap-1 text-[10.5px] text-[var(--color-fg-dim)]">
            rise/drop ft per run
            <input
              className="input input-num !w-16 !px-1 !py-0.5 text-xs"
              type="number"
              min={0}
              step={0.5}
              value={layer.rise_drop_ft}
              onChange={(e) => ws.updateLayer(layer.id, { rise_drop_ft: Number(e.target.value) || 0 })}
            />
          </label>
        )}
        <input
          type="color"
          className="h-6 w-8 cursor-pointer border border-[var(--color-line)] bg-transparent"
          value={layer.color}
          onChange={(e) => ws.updateLayer(layer.id, { color: e.target.value })}
          title="Layer color"
        />
        <button
          className="btn btn-danger !px-2 !py-0.5 text-[10.5px]"
          onClick={() => {
            if (confirm(`Delete layer "${layer.name}" and its takeoff objects?`)) {
              ws.deleteLayer(layer.id);
            }
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
