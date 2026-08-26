// Domain types mirroring the database schema. Geometry coordinates are in
// PDF user-space units (points at scale 1); calibration converts to feet.

export type Tool = "count" | "linear" | "area";
export type TakeoffStatus = "confirmed" | "pending" | "rejected";
export type TakeoffSource = "manual" | "ai";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  labor_rate: number;
  overhead_pct: number;
  profit_pct: number;
  /** Material waste/loss allowance, percent of extended material. */
  waste_pct: number;
  /** Sales tax, percent of material after waste. */
  tax_pct: number;
  /** Labor productivity adjustment, percent. +15 = conditions cost 15% more hours. */
  labor_factor_pct: number;
  created_at: string;
  updated_at: string;
}

/**
 * A cost that does not come from takeoff: gear quotes, lighting packages,
 * subcontractors, permits, equipment rental, bonds. `ohp_applies` decides
 * whether overhead and profit are charged on it or it is carried at cost.
 */
export interface DirectCost {
  id: string;
  project_id: string;
  user_id: string;
  description: string;
  category: DirectCostCategory;
  amount: number;
  ohp_applies: boolean;
  sort_order: number;
}

export type DirectCostCategory =
  | "quote"
  | "subcontractor"
  | "equipment"
  | "permit"
  | "bond"
  | "other";

export interface PlanDocument {
  id: string;
  project_id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  page_count: number;
}

export interface Calibration {
  p1: [number, number];
  p2: [number, number];
  distance_ft: number;
}

export interface Sheet {
  id: string;
  document_id: string;
  project_id: string;
  user_id: string;
  page_number: number;
  name: string;
  scale_ft_per_unit: number | null;
  calibration: Calibration | null;
}

export interface Item {
  id: string;
  user_id: string;
  code: string;
  description: string;
  unit: string;
  material_cost: number;
  labor_hours: number;
}

export interface Assembly {
  id: string;
  user_id: string;
  code: string;
  name: string;
  description: string;
}

export interface AssemblyItem {
  id: string;
  assembly_id: string;
  item_id: string;
  user_id: string;
  quantity: number;
}

export interface Layer {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  color: string;
  tool: Tool;
  item_id: string | null;
  assembly_id: string | null;
  rise_drop_ft: number;
  /** Repeat factor: take off one typical floor, apply it to N identical ones. */
  typical_multiplier: number;
  /** Bid breakdown dimensions. Empty values mean unassigned. */
  area?: string;
  system?: string;
  phase?: string;
  sort_order: number;
}

export type ProposalEntryKind = "inclusion" | "exclusion" | "allowance" | "alternate";

/**
 * Commercial scope shown beside the base bid. Amounts are deliberately
 * reference-only until the estimator chooses the accounting treatment; this
 * prevents an allowance or alternate from silently being counted twice.
 */
export interface ProposalEntry {
  id: string;
  project_id: string;
  user_id: string;
  kind: ProposalEntryKind;
  description: string;
  amount: number;
  pricing_note: string;
  sort_order: number;
}

export type CountGeometry = { x: number; y: number };
export type PathGeometry = { points: [number, number][] };
export type TakeoffGeometry = CountGeometry | PathGeometry;

export interface Takeoff {
  id: string;
  layer_id: string;
  sheet_id: string;
  project_id: string;
  user_id: string;
  kind: Tool;
  geometry: TakeoffGeometry;
  source: TakeoffSource;
  status: TakeoffStatus;
  ai_confidence: number | null;
}

/** A frozen, reproducible copy of every input that produced an issued bid. */
export interface BidSnapshot {
  id: string;
  project_id: string;
  user_id: string;
  revision: number;
  label: string;
  created_at: string;
  bid_price: number;
  material_total: number;
  labor_hours_total: number;
  labor_cost: number;
  warning_count: number;
  payload: BidSnapshotPayload;
}

interface BidSnapshotPayloadBase {
  project: Project;
  documents: PlanDocument[];
  sheets: Sheet[];
  layers: Layer[];
  takeoffs: Takeoff[];
  items: Item[];
  assemblies: Assembly[];
  assembly_items: AssemblyItem[];
  direct_costs: DirectCost[];
  summary: BidSnapshotSummary;
  preflight: BidSnapshotCheck[];
}

export interface BidSnapshotPayloadV1 extends BidSnapshotPayloadBase {
  schema_version: 1;
}

export interface BidSnapshotPayloadV2 extends BidSnapshotPayloadBase {
  schema_version: 2;
  proposal_entries: ProposalEntry[];
}

export type BidSnapshotPayload = BidSnapshotPayloadV1 | BidSnapshotPayloadV2;

export interface BidSnapshotSummary {
  material_base: number;
  material_total: number;
  labor_hours_base: number;
  labor_hours_total: number;
  labor_cost: number;
  prime_cost: number;
  overhead: number;
  profit: number;
  bid_price: number;
}

export interface BidSnapshotCheck {
  id: string;
  severity: "blocker" | "warning";
  title: string;
  detail: string;
}
