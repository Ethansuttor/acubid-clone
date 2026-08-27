// Hand-calculated fixture project used to verify estimating math end to end.
// Keep in sync with the expected values in estimate.test.ts — every number
// below was computed by hand:
//
// Sheet scale: 200 PDF units = 20 ft  =>  0.1 ft/unit
//
// Item database:
//   DPLX-15  duplex receptacle     $2.85   0.20  hr/EA
//   PLT-1G   1-gang plate          $0.55   0.05  hr/EA
//   BOX-4S   4" square box         $3.10   0.25  hr/EA
//   MR-1G    1-gang mud ring       $1.85   0.06  hr/EA
//   EMT-050  1/2" EMT              $0.68   0.032 hr/FT
//   EMT-075  3/4" EMT              $1.02   0.040 hr/FT
//   W-12     #12 THHN              $0.18   0.008 hr/FT
//   LED-2X4  2x4 LED troffer       $89.50  0.75  hr/EA
//
// Assembly A-REC (duplex receptacle assembly), per EA:
//   1 DPLX-15, 1 PLT-1G, 1 BOX-4S, 1 MR-1G, 6 FT EMT-050, 18 FT W-12
//
// Takeoff:
//   Layer "Receptacles" (count -> A-REC): 8 clicks                =>  8 EA
//   Layer "Troffers"    (count -> LED-2X4): 4 clicks              =>  4 EA
//   Layer "Ltg wire"    (linear -> W-12): (0,0)->(1200,0)         => 120 FT (rise/drop 0)
//   Layer "Feeder EMT"  (linear -> EMT-075, rise/drop 5 ft):
//     (0,0)->(400,0)->(400,150) = 550 units = 55 ft + 5           =>  60 FT
//   plus one PENDING ai takeoff on Receptacles that must NOT count.
//
// Expected extension:
//   Receptacles assembly @ 8 EA:
//     DPLX-15  8    x 2.85  = 22.80    8    x 0.20  = 1.600
//     PLT-1G   8    x 0.55  =  4.40    8    x 0.05  = 0.400
//     BOX-4S   8    x 3.10  = 24.80    8    x 0.25  = 2.000
//     MR-1G    8    x 1.85  = 14.80    8    x 0.06  = 0.480
//     EMT-050  48   x 0.68  = 32.64    48   x 0.032 = 1.536
//     W-12     144  x 0.18  = 25.92    144  x 0.008 = 1.152
//   Troffers  LED-2X4 4 x 89.50 = 358.00   4 x 0.75 = 3.000
//   Ltg wire  W-12  120 x 0.18  =  21.60   120 x 0.008 = 0.960
//   Feeder    EMT-075 60 x 1.02 =  61.20   60 x 0.040  = 2.400
//
//   Material total = 125.36 + 358.00 + 21.60 + 61.20 = 566.16
//   Labor hours    = 7.168 + 3.000 + 0.960 + 2.400   = 13.528
//   W-12 rollup    = 144 + 120 = 264 FT => 47.52
//
// Summary at $95/hr, 12% overhead, 10% profit:
//   labor cost = 13.528 x 95        = 1285.16
//   prime      = 566.16 + 1285.16   = 1851.32
//   overhead   = 1851.32 x 0.12     = 222.1584
//   subtotal   = 2073.4784
//   profit     = 2073.4784 x 0.10   = 207.34784
//   bid        = 2280.82624

import type {
  Assembly,
  AssemblyItem,
  DirectCost,
  Item,
  Layer,
  Sheet,
  Takeoff,
} from "@/lib/types";

const U = "u"; // fixture user id

function item(id: string, code: string, description: string, unit: string, cost: number, hrs: number): Item {
  return { id, user_id: U, code, description, unit, material_cost: cost, labor_hours: hrs };
}

export const items: Item[] = [
  item("i-dplx", "DPLX-15", "Duplex receptacle 15A", "EA", 2.85, 0.2),
  item("i-plt", "PLT-1G", "1-gang plate", "EA", 0.55, 0.05),
  item("i-box", "BOX-4S", '4" square box', "EA", 3.1, 0.25),
  item("i-mr", "MR-1G", "1-gang mud ring", "EA", 1.85, 0.06),
  item("i-emt05", "EMT-050", '1/2" EMT', "FT", 0.68, 0.032),
  item("i-emt07", "EMT-075", '3/4" EMT', "FT", 1.02, 0.04),
  item("i-w12", "W-12", "#12 THHN", "FT", 0.18, 0.008),
  item("i-led", "LED-2X4", "2x4 LED troffer", "EA", 89.5, 0.75),
];

export const assemblies: Assembly[] = [
  { id: "a-rec", user_id: U, code: "A-REC", name: "Duplex receptacle assembly", description: "" },
];

export const assemblyItems: AssemblyItem[] = [
  { id: "ai1", assembly_id: "a-rec", item_id: "i-dplx", user_id: U, quantity: 1 },
  { id: "ai2", assembly_id: "a-rec", item_id: "i-plt", user_id: U, quantity: 1 },
  { id: "ai3", assembly_id: "a-rec", item_id: "i-box", user_id: U, quantity: 1 },
  { id: "ai4", assembly_id: "a-rec", item_id: "i-mr", user_id: U, quantity: 1 },
  { id: "ai5", assembly_id: "a-rec", item_id: "i-emt05", user_id: U, quantity: 6 },
  { id: "ai6", assembly_id: "a-rec", item_id: "i-w12", user_id: U, quantity: 18 },
];

export const sheet: Sheet = {
  id: "s1",
  document_id: "d1",
  project_id: "p1",
  user_id: U,
  page_number: 1,
  name: "E-101",
  scale_ft_per_unit: 0.1,
  calibration: { p1: [100, 60], p2: [300, 60], distance_ft: 20 },
};

function layer(id: string, name: string, tool: Layer["tool"], link: Partial<Layer>): Layer {
  return {
    id,
    project_id: "p1",
    user_id: U,
    name,
    color: "#f59e0b",
    tool,
    item_id: null,
    assembly_id: null,
    rise_drop_ft: 0,
    typical_multiplier: 1,
    sort_order: 0,
    ...link,
  };
}

export const layers: Layer[] = [
  layer("l-rec", "Receptacles", "count", { assembly_id: "a-rec" }),
  layer("l-led", "Troffers", "count", { item_id: "i-led" }),
  layer("l-wire", "Ltg wire", "linear", { item_id: "i-w12" }),
  layer("l-emt", "Feeder EMT", "linear", { item_id: "i-emt07", rise_drop_ft: 5 }),
];

let n = 0;
function count(layerId: string, status: Takeoff["status"] = "confirmed"): Takeoff {
  return {
    id: `t${n++}`,
    layer_id: layerId,
    sheet_id: "s1",
    project_id: "p1",
    user_id: U,
    kind: "count",
    geometry: { x: 10 * n, y: 10 * n },
    source: status === "pending" ? "ai" : "manual",
    status,
    ai_confidence: null,
  };
}

function linear(layerId: string, points: [number, number][]): Takeoff {
  return {
    id: `t${n++}`,
    layer_id: layerId,
    sheet_id: "s1",
    project_id: "p1",
    user_id: U,
    kind: "linear",
    geometry: { points },
    source: "manual",
    status: "confirmed",
    ai_confidence: null,
  };
}

export const takeoffs: Takeoff[] = [
  // 8 receptacles + 1 pending AI detection that must not count
  ...Array.from({ length: 8 }, () => count("l-rec")),
  count("l-rec", "pending"),
  // 4 troffers
  ...Array.from({ length: 4 }, () => count("l-led")),
  // lighting wire run: 1200 units = 120 ft
  linear("l-wire", [[0, 0], [1200, 0]]),
  // feeder conduit: 400 + 150 units = 55 ft (+5 rise/drop = 60)
  linear("l-emt", [[0, 0], [400, 0], [400, 150]]),
];

// Baseline markups: no waste, tax, labor factor, burden, small tools,
// escalation, contingency, bond or direct costs, so the hand-calculated
// figures above are the pure takeoff extension.
export const summaryInputs = {
  laborRate: 95,
  overheadPct: 12,
  profitPct: 10,
  wastePct: 0,
  taxPct: 0,
  laborFactorPct: 0,
  laborBurdenPct: 0,
  smallToolsPct: 0,
  escalationPct: 0,
  contingencyPct: 0,
  bondPct: 0,
  directCosts: [] as DirectCost[],
};
