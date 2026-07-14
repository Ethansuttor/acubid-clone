"use client";

// Workspace store: all project data, write-through persistence to Supabase
// (autosave — every mutation is an immediate DB write), and an unlimited
// undo/redo stack for takeoff edits.

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type {
  Assembly,
  AssemblyItem,
  Calibration,
  Item,
  Layer,
  PlanDocument,
  Project,
  Sheet,
  Takeoff,
  Tool,
} from "@/lib/types";

export type EditorTool = "select" | Tool | "calibrate" | "aibox";

type CalibState = { scale_ft_per_unit: number | null; calibration: Calibration | null };

export type Op =
  | { kind: "add-takeoffs"; takeoffs: Takeoff[] }
  | { kind: "delete-takeoffs"; takeoffs: Takeoff[] }
  | { kind: "update-takeoffs"; before: Takeoff[]; after: Takeoff[] }
  | { kind: "calibrate"; sheetId: string; before: CalibState; after: CalibState };

export type SaveState = "saved" | "saving" | "error";

interface WorkspaceState {
  loaded: boolean;
  userId: string | null;
  project: Project | null;
  documents: PlanDocument[];
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
  items: Item[];
  assemblies: Assembly[];
  assemblyItems: AssemblyItem[];

  activeSheetId: string | null;
  activeLayerId: string | null;
  tool: EditorTool;
  selection: Set<string>;
  undoStack: Op[];
  redoStack: Op[];
  saveState: SaveState;
  pendingWrites: number;

  load(projectId: string): Promise<void>;
  setTool(tool: EditorTool): void;
  setActiveSheet(id: string | null): void;
  setActiveLayer(id: string | null): void;
  setSelection(ids: Set<string>): void;

  addTakeoffs(takeoffs: Takeoff[], undoable?: boolean): void;
  deleteTakeoffs(ids: string[]): void;
  updateTakeoffs(after: Takeoff[]): void;
  setCalibration(sheetId: string, calibration: Calibration, scale: number): void;
  undo(): void;
  redo(): void;

  // Non-takeoff CRUD (no undo stack; these are form edits).
  updateProject(patch: Partial<Project>): void;
  addLayer(layer: Layer): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  deleteLayer(id: string): void;
  addDocumentWithSheets(doc: PlanDocument, sheets: Sheet[]): void;
  renameSheet(id: string, name: string): void;
  upsertItem(item: Item): void;
  deleteItem(id: string): void;
  upsertAssembly(a: Assembly): void;
  deleteAssembly(id: string): void;
  setAssemblyItems(assemblyId: string, rows: AssemblyItem[]): void;
}

function track(
  set: (fn: (s: WorkspaceState) => Partial<WorkspaceState>) => void,
  p: PromiseLike<{ error: unknown }>
) {
  set((s) => ({ pendingWrites: s.pendingWrites + 1, saveState: "saving" }));
  Promise.resolve(p).then(({ error }) => {
    if (error) console.error("save failed", error);
    set((s) => {
      const pending = s.pendingWrites - 1;
      return {
        pendingWrites: pending,
        saveState: error ? "error" : pending > 0 ? "saving" : "saved",
      };
    });
  });
}

// Exposed on window for E2E tests and console debugging.
declare global {
  interface Window {
    __ws?: typeof useWorkspace;
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  // Apply an op to local state + database. direction=1 applies, -1 reverts.
  function applyOp(op: Op, direction: 1 | -1) {
    const db = supabase();
    if (op.kind === "add-takeoffs" || op.kind === "delete-takeoffs") {
      const adding = (op.kind === "add-takeoffs") === (direction === 1);
      const ids = new Set(op.takeoffs.map((t) => t.id));
      if (adding) {
        set((s) => ({ takeoffs: [...s.takeoffs, ...op.takeoffs] }));
        track(set, db.from("takeoffs").insert(op.takeoffs));
      } else {
        set((s) => ({
          takeoffs: s.takeoffs.filter((t) => !ids.has(t.id)),
          selection: new Set([...s.selection].filter((id) => !ids.has(id))),
        }));
        track(set, db.from("takeoffs").delete().in("id", [...ids]));
      }
    } else if (op.kind === "update-takeoffs") {
      const rows = direction === 1 ? op.after : op.before;
      const byId = new Map(rows.map((t) => [t.id, t]));
      set((s) => ({ takeoffs: s.takeoffs.map((t) => byId.get(t.id) ?? t) }));
      track(set, db.from("takeoffs").upsert(rows));
    } else if (op.kind === "calibrate") {
      const c = direction === 1 ? op.after : op.before;
      set((s) => ({
        sheets: s.sheets.map((sh) => (sh.id === op.sheetId ? { ...sh, ...c } : sh)),
      }));
      track(set, db.from("sheets").update(c).eq("id", op.sheetId));
    }
  }

  function pushOp(op: Op) {
    applyOp(op, 1);
    set((s) => ({ undoStack: [...s.undoStack, op], redoStack: [] }));
  }

  return {
    loaded: false,
    userId: null,
    project: null,
    documents: [],
    sheets: [],
    layers: [],
    takeoffs: [],
    items: [],
    assemblies: [],
    assemblyItems: [],
    activeSheetId: null,
    activeLayerId: null,
    tool: "select",
    selection: new Set(),
    undoStack: [],
    redoStack: [],
    saveState: "saved",
    pendingWrites: 0,

    async load(projectId) {
      const db = supabase();
      const { data: auth } = await db.auth.getUser();
      const userId = auth.user?.id ?? null;
      const [project, documents, sheets, layers, takeoffs, items, assemblies, assemblyItems] =
        await Promise.all([
          db.from("projects").select("*").eq("id", projectId).single(),
          db.from("documents").select("*").eq("project_id", projectId).order("created_at"),
          db.from("sheets").select("*").eq("project_id", projectId).order("page_number"),
          db.from("layers").select("*").eq("project_id", projectId).order("sort_order"),
          db.from("takeoffs").select("*").eq("project_id", projectId),
          db.from("items").select("*").order("code"),
          db.from("assemblies").select("*").order("code"),
          db.from("assembly_items").select("*"),
        ]);
      set(() => ({
        loaded: true,
        userId,
        project: (project.data as Project) ?? null,
        documents: (documents.data as PlanDocument[]) ?? [],
        sheets: (sheets.data as Sheet[]) ?? [],
        layers: (layers.data as Layer[]) ?? [],
        takeoffs: (takeoffs.data as Takeoff[]) ?? [],
        items: (items.data as Item[]) ?? [],
        assemblies: (assemblies.data as Assembly[]) ?? [],
        assemblyItems: (assemblyItems.data as AssemblyItem[]) ?? [],
        activeSheetId: (sheets.data?.[0] as Sheet | undefined)?.id ?? null,
        activeLayerId: (layers.data?.[0] as Layer | undefined)?.id ?? null,
        undoStack: [],
        redoStack: [],
        selection: new Set(),
      }));
    },

    setTool: (tool) => set(() => ({ tool })),
    setActiveSheet: (activeSheetId) => set(() => ({ activeSheetId, selection: new Set() })),
    setActiveLayer: (activeLayerId) => set(() => ({ activeLayerId })),
    setSelection: (selection) => set(() => ({ selection })),

    addTakeoffs: (takeoffs, undoable = true) => {
      if (takeoffs.length === 0) return;
      if (undoable) pushOp({ kind: "add-takeoffs", takeoffs });
      else applyOp({ kind: "add-takeoffs", takeoffs }, 1);
    },
    deleteTakeoffs: (ids) => {
      const doomed = get().takeoffs.filter((t) => ids.includes(t.id));
      if (doomed.length === 0) return;
      pushOp({ kind: "delete-takeoffs", takeoffs: doomed });
    },
    updateTakeoffs: (after) => {
      const byId = new Map(get().takeoffs.map((t) => [t.id, t]));
      const before = after.map((t) => byId.get(t.id)).filter((t): t is Takeoff => !!t);
      if (before.length !== after.length) return;
      pushOp({ kind: "update-takeoffs", before, after });
    },
    setCalibration: (sheetId, calibration, scale) => {
      const sheet = get().sheets.find((s) => s.id === sheetId);
      if (!sheet) return;
      pushOp({
        kind: "calibrate",
        sheetId,
        before: { scale_ft_per_unit: sheet.scale_ft_per_unit, calibration: sheet.calibration },
        after: { scale_ft_per_unit: scale, calibration },
      });
    },

    undo: () => {
      const s = get();
      const op = s.undoStack[s.undoStack.length - 1];
      if (!op) return;
      applyOp(op, -1);
      set((st) => ({ undoStack: st.undoStack.slice(0, -1), redoStack: [...st.redoStack, op] }));
    },
    redo: () => {
      const s = get();
      const op = s.redoStack[s.redoStack.length - 1];
      if (!op) return;
      applyOp(op, 1);
      set((st) => ({ redoStack: st.redoStack.slice(0, -1), undoStack: [...st.undoStack, op] }));
    },

    updateProject: (patch) => {
      const p = get().project;
      if (!p) return;
      const next = { ...p, ...patch, updated_at: new Date().toISOString() };
      set(() => ({ project: next }));
      track(set, supabase().from("projects").update({ ...patch, updated_at: next.updated_at }).eq("id", p.id));
    },
    addLayer: (layer) => {
      set((s) => ({ layers: [...s.layers, layer], activeLayerId: layer.id }));
      track(set, supabase().from("layers").insert(layer));
    },
    updateLayer: (id, patch) => {
      set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
      track(set, supabase().from("layers").update(patch).eq("id", id));
    },
    deleteLayer: (id) => {
      set((s) => ({
        layers: s.layers.filter((l) => l.id !== id),
        takeoffs: s.takeoffs.filter((t) => t.layer_id !== id),
        activeLayerId: s.activeLayerId === id ? null : s.activeLayerId,
        undoStack: [],
        redoStack: [],
      }));
      track(set, supabase().from("layers").delete().eq("id", id));
    },
    addDocumentWithSheets: (doc, sheets) => {
      set((s) => ({
        documents: [...s.documents, doc],
        sheets: [...s.sheets, ...sheets],
        activeSheetId: s.activeSheetId ?? sheets[0]?.id ?? null,
      }));
    },
    renameSheet: (id, name) => {
      set((s) => ({ sheets: s.sheets.map((sh) => (sh.id === id ? { ...sh, name } : sh)) }));
      track(set, supabase().from("sheets").update({ name }).eq("id", id));
    },
    upsertItem: (item) => {
      set((s) => {
        const exists = s.items.some((i) => i.id === item.id);
        return {
          items: exists ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item],
        };
      });
      track(set, supabase().from("items").upsert(item));
    },
    deleteItem: (id) => {
      set((s) => ({
        items: s.items.filter((i) => i.id !== id),
        assemblyItems: s.assemblyItems.filter((ai) => ai.item_id !== id),
      }));
      track(set, supabase().from("items").delete().eq("id", id));
    },
    upsertAssembly: (a) => {
      set((s) => {
        const exists = s.assemblies.some((x) => x.id === a.id);
        return {
          assemblies: exists ? s.assemblies.map((x) => (x.id === a.id ? a : x)) : [...s.assemblies, a],
        };
      });
      track(set, supabase().from("assemblies").upsert(a));
    },
    deleteAssembly: (id) => {
      set((s) => ({
        assemblies: s.assemblies.filter((a) => a.id !== id),
        assemblyItems: s.assemblyItems.filter((ai) => ai.assembly_id !== id),
      }));
      track(set, supabase().from("assemblies").delete().eq("id", id));
    },
    // (window hook attached below the store definition)
    setAssemblyItems: (assemblyId, rows) => {
      set((s) => ({
        assemblyItems: [...s.assemblyItems.filter((ai) => ai.assembly_id !== assemblyId), ...rows],
      }));
      const db = supabase();
      track(
        set,
        db
          .from("assembly_items")
          .delete()
          .eq("assembly_id", assemblyId)
          .then(async () => (rows.length ? await db.from("assembly_items").insert(rows) : { error: null }))
      );
    },
  };
});

if (typeof window !== "undefined") {
  window.__ws = useWorkspace;
}
