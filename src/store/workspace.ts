"use client";

// Workspace store: all project data, write-through persistence to the active
// local data client (autosave — every mutation is an immediate write), and an
// unlimited undo/redo stack for takeoff edits.

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  estimateTotals,
  extendEstimate,
  layerQuantities,
  summarize,
} from "@/lib/estimate";
import { bidPreflight } from "@/lib/preflight";
import type {
  Assembly,
  AssemblyItem,
  BidSnapshot,
  Calibration,
  DirectCost,
  Item,
  Layer,
  PlanDocument,
  ProposalEntry,
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
  loadError: string | null;
  userId: string | null;
  project: Project | null;
  documents: PlanDocument[];
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
  items: Item[];
  assemblies: Assembly[];
  assemblyItems: AssemblyItem[];
  directCosts: DirectCost[];
  proposalEntries: ProposalEntry[];
  snapshots: BidSnapshot[];

  activeSheetId: string | null;
  activeLayerId: string | null;
  tool: EditorTool;
  selection: Set<string>;
  undoStack: Op[];
  redoStack: Op[];
  saveState: SaveState;
  pendingWrites: number;
  failedWrites: number;
  saveError: string | null;

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
  upsertDirectCost(cost: DirectCost): void;
  deleteDirectCost(id: string): void;
  upsertProposalEntry(entry: ProposalEntry): void;
  deleteProposalEntry(id: string): void;
  createBidSnapshot(label: string): Promise<{ snapshot: BidSnapshot | null; error: string | null }>;
}

// All persistence writes run through a single FIFO queue so that rapid
// sequences (add takeoff -> undo -> redo) hit the database in order.
// Persistence query builders execute lazily on await, so queueing the builder
// (or a thunk) defers the actual operation until its turn.
let writeQueue: Promise<unknown> = Promise.resolve();
let snapshotWriteInProgress = false;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error || "Unknown persistence error");
}

function track(
  set: (fn: (s: WorkspaceState) => Partial<WorkspaceState>) => void,
  job: PromiseLike<{ error: unknown }> | (() => PromiseLike<{ error: unknown }>)
) {
  set((s) => ({ pendingWrites: s.pendingWrites + 1, saveState: "saving" }));
  const run = typeof job === "function" ? job : () => job;
  writeQueue = writeQueue
    .then(() => run())
    .then(
      ({ error }) => {
        if (error) console.error("save failed", error);
        set((s) => {
          const pending = Math.max(0, s.pendingWrites - 1);
          const failedWrites = s.failedWrites + (error ? 1 : 0);
          return {
            pendingWrites: pending,
            failedWrites,
            saveError: error ? errorMessage(error) : s.saveError,
            saveState:
              error || failedWrites > 0 ? "error" : pending > 0 ? "saving" : "saved",
          };
        });
      },
      (error) => {
        console.error("save failed", error);
        set((s) => ({
          pendingWrites: Math.max(0, s.pendingWrites - 1),
          failedWrites: s.failedWrites + 1,
          saveError: errorMessage(error),
          saveState: "error",
        }));
      }
    );
}

function immutableCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    loadError: null,
    userId: null,
    project: null,
    documents: [],
    sheets: [],
    layers: [],
    takeoffs: [],
    items: [],
    assemblies: [],
    assemblyItems: [],
    directCosts: [],
    proposalEntries: [],
    snapshots: [],
    activeSheetId: null,
    activeLayerId: null,
    tool: "select",
    selection: new Set(),
    undoStack: [],
    redoStack: [],
    saveState: "saved",
    pendingWrites: 0,
    failedWrites: 0,
    saveError: null,

    async load(projectId) {
      set(() => ({ loaded: false, loadError: null }));
      const db = supabase();
      const { data: auth } = await db.auth.getUser();
      const userId = auth.user?.id ?? null;
      const [
        project,
        documents,
        sheets,
        layers,
        takeoffs,
        items,
        assemblies,
        assemblyItems,
        directCosts,
        proposalEntries,
        snapshots,
      ] = await Promise.all([
          db.from("projects").select("*").eq("id", projectId).single(),
          db.from("documents").select("*").eq("project_id", projectId).order("created_at"),
          db.from("sheets").select("*").eq("project_id", projectId).order("page_number"),
          db.from("layers").select("*").eq("project_id", projectId).order("sort_order"),
          db.from("takeoffs").select("*").eq("project_id", projectId),
          db.from("items").select("*").order("code"),
          db.from("assemblies").select("*").order("code"),
          db.from("assembly_items").select("*"),
          db.from("direct_costs").select("*").eq("project_id", projectId).order("sort_order"),
          db.from("proposal_entries").select("*").eq("project_id", projectId).order("sort_order"),
          db
            .from("bid_snapshots")
            .select("*")
            .eq("project_id", projectId)
            .order("revision", { ascending: false }),
        ]);

      const requiredResults = [
        ["project", project],
        ["documents", documents],
        ["sheets", sheets],
        ["layers", layers],
        ["takeoffs", takeoffs],
        ["items", items],
        ["assemblies", assemblies],
        ["assembly components", assemblyItems],
        ["direct costs", directCosts],
        ["proposal entries", proposalEntries],
        ["bid snapshots", snapshots],
      ] as const;
      const failures = requiredResults.filter(([, result]) => result.error);
      if (failures.length > 0 || !project.data) {
        const names = failures.map(([name]) => name);
        set(() => ({
          loaded: true,
          loadError: names.length
            ? `Could not load required project data: ${names.join(", ")}.`
            : "The requested project does not exist on this device.",
          project: null,
          documents: [],
          sheets: [],
          layers: [],
          takeoffs: [],
          items: [],
          assemblies: [],
          assemblyItems: [],
          directCosts: [],
          proposalEntries: [],
          snapshots: [],
          activeSheetId: null,
          activeLayerId: null,
          selection: new Set(),
          undoStack: [],
          redoStack: [],
        }));
        return;
      }

      set(() => ({
        loaded: true,
        loadError: null,
        userId,
        project: (project.data as Project) ?? null,
        documents: (documents.data as PlanDocument[]) ?? [],
        sheets: (sheets.data as Sheet[]) ?? [],
        layers: ((layers.data as Layer[]) ?? []).map((layer) => ({
          ...layer,
          area: layer.area ?? "",
          system: layer.system ?? "",
          phase: layer.phase ?? "",
        })),
        takeoffs: (takeoffs.data as Takeoff[]) ?? [],
        items: (items.data as Item[]) ?? [],
        assemblies: (assemblies.data as Assembly[]) ?? [],
        assemblyItems: (assemblyItems.data as AssemblyItem[]) ?? [],
        directCosts: (directCosts.data as DirectCost[]) ?? [],
        proposalEntries: (proposalEntries.data as ProposalEntry[]) ?? [],
        snapshots: (snapshots.data as BidSnapshot[]) ?? [],
        activeSheetId: (sheets.data?.[0] as Sheet | undefined)?.id ?? null,
        activeLayerId: (layers.data?.[0] as Layer | undefined)?.id ?? null,
        undoStack: [],
        redoStack: [],
        selection: new Set(),
        saveState: "saved",
        pendingWrites: 0,
        failedWrites: 0,
        saveError: null,
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
    upsertDirectCost: (cost) => {
      set((s) => {
        const exists = s.directCosts.some((c) => c.id === cost.id);
        return {
          directCosts: exists
            ? s.directCosts.map((c) => (c.id === cost.id ? cost : c))
            : [...s.directCosts, cost],
        };
      });
      track(set, supabase().from("direct_costs").upsert(cost));
    },
    deleteDirectCost: (id) => {
      set((s) => ({ directCosts: s.directCosts.filter((c) => c.id !== id) }));
      track(set, supabase().from("direct_costs").delete().eq("id", id));
    },
    upsertProposalEntry: (entry) => {
      set((s) => {
        const exists = s.proposalEntries.some((item) => item.id === entry.id);
        return {
          proposalEntries: exists
            ? s.proposalEntries.map((item) => (item.id === entry.id ? entry : item))
            : [...s.proposalEntries, entry],
        };
      });
      track(set, supabase().from("proposal_entries").upsert(entry));
    },
    deleteProposalEntry: (id) => {
      set((s) => ({ proposalEntries: s.proposalEntries.filter((item) => item.id !== id) }));
      track(set, supabase().from("proposal_entries").delete().eq("id", id));
    },

    createBidSnapshot: async (label) => {
      if (snapshotWriteInProgress) {
        return { snapshot: null, error: "A bid snapshot is already being created." };
      }
      snapshotWriteInProgress = true;
      try {
        const state = get();
        if (!state.project || !state.userId) {
          return { snapshot: null, error: "The project is not loaded." };
        }

        const quantities = layerQuantities(state.layers, state.takeoffs, state.sheets);
        const { lines, issues } = extendEstimate(
          quantities,
          state.items,
          state.assemblies,
          state.assemblyItems
        );
        const summary = summarize({
          ...estimateTotals(lines),
          laborRate: state.project.labor_rate,
          wastePct: state.project.waste_pct,
          taxPct: state.project.tax_pct,
          laborFactorPct: state.project.labor_factor_pct,
          overheadPct: state.project.overhead_pct,
          profitPct: state.project.profit_pct,
          directCosts: state.directCosts,
        });
        const preflight = bidPreflight({
          project: state.project,
          sheets: state.sheets,
          layers: state.layers,
          takeoffs: state.takeoffs,
          lines,
          issues,
          summary,
          directCosts: state.directCosts,
          pendingWrites: state.pendingWrites,
          saveState: state.saveState,
        });
        if (!preflight.ready) {
          return {
            snapshot: null,
            error: `Resolve ${preflight.blockers.length} bid-readiness ${preflight.blockers.length === 1 ? "blocker" : "blockers"} first.`,
          };
        }

        const revision =
          Math.max(0, ...state.snapshots.map((snapshot) => snapshot.revision)) + 1;
        const snapshot: BidSnapshot = immutableCopy({
          id: crypto.randomUUID(),
          project_id: state.project.id,
          user_id: state.userId,
          revision,
          label: label.trim() || `Bid revision ${revision}`,
          created_at: new Date().toISOString(),
          bid_price: summary.bidPrice,
          material_total: summary.materialTotal,
          labor_hours_total: summary.laborHoursTotal,
          labor_cost: summary.laborCost,
          warning_count: preflight.warnings.length,
          payload: {
            schema_version: 2,
            project: state.project,
            documents: state.documents,
            sheets: state.sheets,
            layers: state.layers,
            takeoffs: state.takeoffs,
            items: state.items,
            assemblies: state.assemblies,
            assembly_items: state.assemblyItems,
            direct_costs: state.directCosts,
            proposal_entries: state.proposalEntries,
            summary: {
              material_base: summary.materialBase,
              material_total: summary.materialTotal,
              labor_hours_base: summary.laborHoursBase,
              labor_hours_total: summary.laborHoursTotal,
              labor_cost: summary.laborCost,
              prime_cost: summary.primeCost,
              overhead: summary.overhead,
              profit: summary.profit,
              bid_price: summary.bidPrice,
            },
            preflight: preflight.checks,
          },
        });

        const { error } = await supabase().from("bid_snapshots").insert(snapshot);
        if (error) {
          const message = errorMessage(error);
          set((s) => ({
            failedWrites: s.failedWrites + 1,
            saveState: "error",
            saveError: message,
          }));
          return { snapshot: null, error: message };
        }
        set((s) => ({ snapshots: [snapshot, ...s.snapshots] }));
        return { snapshot, error: null };
      } finally {
        snapshotWriteInProgress = false;
      }
    },

    // (window hook attached below the store definition)
    setAssemblyItems: (assemblyId, rows) => {
      set((s) => ({
        assemblyItems: [...s.assemblyItems.filter((ai) => ai.assembly_id !== assemblyId), ...rows],
      }));
      const db = supabase();
      track(set, async () => {
        const del = await db.from("assembly_items").delete().eq("assembly_id", assemblyId);
        if (del.error) return del;
        return rows.length ? await db.from("assembly_items").insert(rows) : { error: null };
      });
    },
  };
});

if (typeof window !== "undefined") {
  window.__ws = useWorkspace;
}
