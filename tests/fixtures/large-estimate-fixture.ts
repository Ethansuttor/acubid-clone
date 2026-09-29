import type {
  Assembly,
  AssemblyItem,
  Calibration,
  DirectCost,
  DirectCostCategory,
  Item,
  Layer,
  PlanDocument,
  Project,
  Sheet,
  Takeoff,
  Tool,
} from "@/lib/types";

/**
 * Fast, seedable 32-bit PRNG (Mulberry32).
 * Guarantees 100% deterministic outputs across environments and runs.
 */
export function createMulberry32(seed = 42) {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    nextFloat(min: number, max: number): number {
      return this.next() * (max - min) + min;
    },
    choice<T>(arr: readonly T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
    boolean(p = 0.5): boolean {
      return this.next() < p;
    },
  };
}

export interface LargeEstimateFixture {
  project: Project;
  documents: PlanDocument[];
  sheets: Sheet[];
  items: Item[];
  assemblies: Assembly[];
  assemblyItems: AssemblyItem[];
  layers: Layer[];
  takeoffs: Takeoff[];
  directCosts: DirectCost[];
}

export interface LargeEstimateFixtureOptions {
  seed?: number;
  sheetCount?: number;
  layerCount?: number;
  itemCount?: number;
  assemblyCount?: number;
  assemblyItemCount?: number;
  takeoffCount?: number;
  directCostCount?: number;
}

const DEFAULT_OPTIONS: Required<LargeEstimateFixtureOptions> = {
  seed: 42,
  sheetCount: 50,
  layerCount: 200,
  itemCount: 1000,
  assemblyCount: 200,
  assemblyItemCount: 1200,
  takeoffCount: 10000,
  directCostCount: 50,
};

const COLOR_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e", "#64748b", "#78716c", "#0284c7",
];

const DIRECT_COST_CATEGORIES: DirectCostCategory[] = [
  "quote",
  "subcontractor",
  "equipment",
  "permit",
  "bond",
  "other",
];

const DIRECT_COST_DESCRIPTIONS: Record<DirectCostCategory, string[]> = {
  quote: [
    "Switchgear Package (4000A Main, 480V Distribution)",
    "Emergency Generator (750kW Diesel with ATS)",
    "Lighting Fixture Package (Architectural & High-Bay)",
    "Fire Alarm Control Panel & Voice Evac Package",
    "Medium Voltage Transformers (15kV / 480V Oil-Filled)",
    "UPS System (250kVA Modular Double Conversion)",
    "Variable Frequency Drives Package (HVAC Pumps & Fans)",
    "Security & Access Control Head-End Hardware",
  ],
  subcontractor: [
    "Directional Boring & Trenching Subcontractor",
    "High Voltage Splicing & Termination Specialist",
    "Testing, Commissioning & NETA Certification",
    "Lightning Protection System Installation Subcontractor",
    "Core Drilling & X-Ray Scanning Subcontractor",
    "Traffic Control & Street Work Subcontractor",
  ],
  equipment: [
    "60ft Articulated Boom Lift Rental (3 Months)",
    "Scissor Lifts Package (4x 26ft Electric Units)",
    "Conduit Bending & Cable Pulling Rig Trailer",
    "Temporary Site Power Distribution & Generator Rental",
    "Bucket Truck Rental for Site Lighting Poles",
  ],
  permit: [
    "City Electrical Building Permit & Plan Check Fees",
    "Utility Interconnection Application & Inspection Fee",
    "Fire Marshal Plan Review & Acceptance Testing Fee",
    "Environmental & Street Cut Encroachment Permit",
  ],
  bond: [
    "Performance & Payment Bond (100% Contract Value)",
    "Maintenance Warranty Bond (2-Year Term)",
    "Public Works Bid Bond & License Endorsement",
  ],
  other: [
    "BIM / VDC Coordination & Clash Detection Modeling",
    "Project Safety Manager & Site OSHA Compliance",
    "Field Office Mobilization & Storage Containers",
    "As-Built BIM Record Drawings & O&M Manuals",
  ],
};

const ITEM_CATEGORIES = [
  { prefix: "CONDUIT", name: "Conduit & Raceway", unit: "FT", tool: "linear" as Tool, costRange: [0.65, 8.50], laborRange: [0.03, 0.12] },
  { prefix: "WIRE", name: "Copper Wire & Cable", unit: "FT", tool: "linear" as Tool, costRange: [0.15, 4.20], laborRange: [0.006, 0.045] },
  { prefix: "FEEDER", name: "Feeder Cable & MC", unit: "FT", tool: "linear" as Tool, costRange: [2.50, 45.00], laborRange: [0.04, 0.35] },
  { prefix: "BOX", name: "Boxes, Enclosures & Rings", unit: "EA", tool: "count" as Tool, costRange: [1.20, 18.50], laborRange: [0.08, 0.45] },
  { prefix: "DEV", name: "Wiring Devices & Plates", unit: "EA", tool: "count" as Tool, costRange: [1.80, 42.00], laborRange: [0.10, 0.35] },
  { prefix: "LUM", name: "Luminaires & Drivers", unit: "EA", tool: "count" as Tool, costRange: [35.00, 450.00], laborRange: [0.40, 1.80] },
  { prefix: "PNL", name: "Panels, Breakers & Disconnects", unit: "EA", tool: "count" as Tool, costRange: [45.00, 2400.00], laborRange: [0.50, 8.00] },
  { prefix: "FIT", name: "Fittings, Fasteners & Hangers", unit: "EA", tool: "count" as Tool, costRange: [0.45, 12.00], laborRange: [0.02, 0.15] },
  { prefix: "AREA", name: "Demolition & Area Works", unit: "SF", tool: "area" as Tool, costRange: [0.50, 6.00], laborRange: [0.01, 0.08] },
];

export function generateLargeEstimateFixture(
  customOptions?: LargeEstimateFixtureOptions
): LargeEstimateFixture {
  const opts: Required<LargeEstimateFixtureOptions> = {
    ...DEFAULT_OPTIONS,
    ...customOptions,
  };

  const rng = createMulberry32(opts.seed);
  const userId = "user-bench";
  const projectId = "proj-bench-large";

  // 1. Project
  const project: Project = {
    id: projectId,
    user_id: userId,
    name: "Benchmark Mega Hospital Project",
    labor_rate: 95.0,
    overhead_pct: 12.0,
    profit_pct: 10.0,
    waste_pct: 5.0,
    tax_pct: 7.5,
    labor_factor_pct: 10.0,
    labor_burden_pct: 0.0,
    small_tools_pct: 0.0,
    contingency_pct: 0.0,
    escalation_pct: 0.0,
    bond_pct: 0.0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  // 2. Documents (5 documents)
  const docCount = 5;
  const docsPerSheet = Math.ceil(opts.sheetCount / docCount);
  const documents: PlanDocument[] = [];
  for (let d = 1; d <= docCount; d++) {
    documents.push({
      id: `doc-${d}`,
      project_id: projectId,
      user_id: userId,
      filename: `Hospital_Building_Set_Vol${d}.pdf`,
      storage_path: `projects/${projectId}/Hospital_Building_Set_Vol${d}.pdf`,
      page_count: docsPerSheet,
    });
  }

  // 3. Sheets (50 sheets)
  const sheets: Sheet[] = [];
  const standardCalibration: Calibration = {
    p1: [100, 100],
    p2: [300, 100],
    distance_ft: 20.0,
  };
  const standardScale = 0.1; // 20 ft / 200 pts = 0.1 ft/pt

  for (let s = 1; s <= opts.sheetCount; s++) {
    const docIdx = Math.floor((s - 1) / docsPerSheet);
    const doc = documents[Math.min(docIdx, documents.length - 1)];
    const pageNum = ((s - 1) % docsPerSheet) + 1;
    const floor = Math.floor((s - 1) / 5) + 1;
    const disc = ["Lighting", "Power", "Low Voltage", "Fire Alarm", "HVAC Feeds"][(s - 1) % 5];
    sheets.push({
      id: `sheet-${String(s).padStart(3, "0")}`,
      document_id: doc.id,
      project_id: projectId,
      user_id: userId,
      page_number: pageNum,
      name: `E${floor}.${String(pageNum).padStart(2, "0")} - Level ${floor} ${disc}`,
      scale_ft_per_unit: standardScale,
      calibration: { ...standardCalibration },
    });
  }

  // 4. Catalog Items (1,000 items)
  const items: Item[] = [];
  for (let i = 1; i <= opts.itemCount; i++) {
    const cat = ITEM_CATEGORIES[(i - 1) % ITEM_CATEGORIES.length];
    const cost = Math.round(rng.nextFloat(cat.costRange[0], cat.costRange[1]) * 100) / 100;
    const labor = Math.round(rng.nextFloat(cat.laborRange[0], cat.laborRange[1]) * 1000) / 1000;
    const seq = String(Math.floor((i - 1) / ITEM_CATEGORIES.length) + 1).padStart(3, "0");
    items.push({
      id: `item-${String(i).padStart(4, "0")}`,
      user_id: userId,
      code: `${cat.prefix}-${seq}`,
      description: `${cat.name} Specification Grade Component #${seq}`,
      unit: cat.unit,
      material_cost: cost,
      labor_hours: labor,
    });
  }

  // 5. Assemblies & Assembly Items (200 assemblies, 1,200 assembly items)
  const assemblies: Assembly[] = [];
  const assemblyItems: AssemblyItem[] = [];
  const itemsPerAssembly = Math.floor(opts.assemblyItemCount / opts.assemblyCount);
  let asmItemSeq = 1;

  for (let a = 1; a <= opts.assemblyCount; a++) {
    const asmId = `asm-${String(a).padStart(3, "0")}`;
    const code = `ASM-${String(a).padStart(3, "0")}`;
    assemblies.push({
      id: asmId,
      user_id: userId,
      code,
      name: `Commercial Electrical System Assembly ${code}`,
      description: `Complete takeoff-ready component package with standard fittings and allowances #${a}`,
    });

    for (let k = 1; k <= itemsPerAssembly; k++) {
      const targetItemIdx = (a * 7 + k * 13) % items.length;
      const targetItem = items[targetItemIdx];
      const qty = targetItem.unit === "FT" ? rng.nextInt(5, 25) : rng.nextInt(1, 4);
      assemblyItems.push({
        id: `asm-item-${String(asmItemSeq++).padStart(4, "0")}`,
        assembly_id: asmId,
        item_id: targetItem.id,
        user_id: userId,
        quantity: qty,
      });
    }
  }

  while (asmItemSeq <= opts.assemblyItemCount) {
    const asmId = assemblies[(asmItemSeq - 1) % assemblies.length].id;
    const targetItem = items[(asmItemSeq * 17) % items.length];
    assemblyItems.push({
      id: `asm-item-${String(asmItemSeq++).padStart(4, "0")}`,
      assembly_id: asmId,
      item_id: targetItem.id,
      user_id: userId,
      quantity: 1,
    });
  }

  // 6. Layers (200 layers)
  const layers: Layer[] = [];
  for (let l = 1; l <= opts.layerCount; l++) {
    let tool: Tool;
    if (l <= 90) tool = "count";
    else if (l <= 170) tool = "linear";
    else tool = "area";

    let itemId: string | null = null;
    let assemblyId: string | null = null;

    if (l <= 120) {
      assemblyId = assemblies[(l - 1) % assemblies.length].id;
    } else if (l <= 190) {
      const matchingItems = items.filter((it) => {
        if (tool === "count") return it.unit === "EA";
        if (tool === "linear") return it.unit === "FT";
        return it.unit === "SF";
      });
      itemId = matchingItems[(l - 1) % matchingItems.length].id;
    } else {
      itemId = null;
      assemblyId = null;
    }

    const riseDrop = tool === "linear" ? (l % 5 === 0 ? 8 : (l % 3 === 0 ? 4 : 0)) : 0;
    const typicalMult = l % 15 === 0 ? 3 : (l % 8 === 0 ? 2 : 1);

    layers.push({
      id: `layer-${String(l).padStart(3, "0")}`,
      project_id: projectId,
      user_id: userId,
      name: `Takeoff Layer ${String(l).padStart(3, "0")} (${tool.toUpperCase()})`,
      color: COLOR_PALETTE[(l - 1) % COLOR_PALETTE.length],
      tool,
      item_id: itemId,
      assembly_id: assemblyId,
      rise_drop_ft: riseDrop,
      typical_multiplier: typicalMult,
      sort_order: l,
    });
  }

  // 7. Takeoffs (10,000 takeoffs)
  const takeoffs: Takeoff[] = [];
  for (let t = 1; t <= opts.takeoffCount; t++) {
    const layer = layers[(t - 1) % layers.length];
    const sheet = sheets[(t - 1) % sheets.length];

    const statusRoll = rng.next();
    let status: Takeoff["status"] = "confirmed";
    let source: Takeoff["source"] = "manual";
    let confidence: number | null = null;

    if (statusRoll > 0.99) {
      status = "rejected";
      source = "ai";
      confidence = Math.round(rng.nextFloat(0.50, 0.74) * 100) / 100;
    } else if (statusRoll > 0.95) {
      status = "pending";
      source = "ai";
      confidence = Math.round(rng.nextFloat(0.75, 0.99) * 100) / 100;
    } else if (t % 4 === 0) {
      source = "ai";
      confidence = Math.round(rng.nextFloat(0.85, 0.99) * 100) / 100;
    }

    let geometry: Takeoff["geometry"];
    if (layer.tool === "count") {
      geometry = {
        x: Math.round(rng.nextFloat(100, 2400) * 10) / 10,
        y: Math.round(rng.nextFloat(100, 1800) * 10) / 10,
      };
    } else if (layer.tool === "linear") {
      const segCount = rng.nextInt(2, 6);
      const points: [number, number][] = [];
      let curX = rng.nextFloat(200, 2000);
      let curY = rng.nextFloat(200, 1600);
      points.push([Math.round(curX * 10) / 10, Math.round(curY * 10) / 10]);

      for (let p = 1; p < segCount; p++) {
        const dx = rng.nextFloat(-300, 300);
        const dy = rng.nextFloat(-300, 300);
        curX = Math.max(50, Math.min(2500, curX + dx));
        curY = Math.max(50, Math.min(1900, curY + dy));
        points.push([Math.round(curX * 10) / 10, Math.round(curY * 10) / 10]);
      }
      geometry = { points };
    } else {
      const centerX = rng.nextFloat(300, 2100);
      const centerY = rng.nextFloat(300, 1500);
      const radiusX = rng.nextFloat(80, 250);
      const radiusY = rng.nextFloat(80, 250);
      const numVerts = rng.nextInt(4, 6);
      const points: [number, number][] = [];

      for (let v = 0; v < numVerts; v++) {
        const angle = (v * 2 * Math.PI) / numVerts;
        const px = centerX + radiusX * Math.cos(angle);
        const py = centerY + radiusY * Math.sin(angle);
        points.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
      }
      geometry = { points };
    }

    takeoffs.push({
      id: `takeoff-${String(t).padStart(5, "0")}`,
      layer_id: layer.id,
      sheet_id: sheet.id,
      project_id: projectId,
      user_id: userId,
      kind: layer.tool,
      geometry,
      source,
      status,
      ai_confidence: confidence,
    });
  }

  // 8. Direct Costs (50 items)
  const directCosts: DirectCost[] = [];
  for (let c = 1; c <= opts.directCostCount; c++) {
    const category = DIRECT_COST_CATEGORIES[(c - 1) % DIRECT_COST_CATEGORIES.length];
    const descPool = DIRECT_COST_DESCRIPTIONS[category];
    const baseDesc = descPool[(c - 1) % descPool.length];
    const amount = Math.round(rng.nextFloat(1500, 85000) * 100) / 100;
    const ohp = c % 4 !== 0;

    directCosts.push({
      id: `dc-${String(c).padStart(3, "0")}`,
      project_id: projectId,
      user_id: userId,
      description: `${baseDesc} [Item #${c}]`,
      category,
      amount,
      ohp_applies: ohp,
      sort_order: c,
    });
  }

  return {
    project,
    documents,
    sheets,
    items,
    assemblies,
    assemblyItems,
    layers,
    takeoffs,
    directCosts,
  };
}
