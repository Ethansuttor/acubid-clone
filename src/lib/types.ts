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
  /** Payroll tax, insurance and fringes, percent of labor cost. */
  labor_burden_pct: number;
  /** Small tools and consumables, percent of labor cost. Typically 1-3. */
  small_tools_pct: number;
  /** Material price movement to buyout, percent of the material total. */
  escalation_pct: number;
  /** Cost buffer, percent of prime cost. Marked up like any other cost. */
  contingency_pct: number;
  /** Bond premium, percent of the bid price — which includes the bond. */
  bond_pct: number;
  created_at: string;
  updated_at: string;
}

/**
 * A cost that does not come from takeoff: gear quotes, lighting packages,
 * subcontractors, permits, equipment rental, bonds. `ohp_applies` decides
 * whether overhead and profit are charged on it or it is carried at cost;
 * `taxable` decides whether sales tax is added to it.
 */
export interface DirectCost {
  id: string;
  project_id: string;
  user_id: string;
  description: string;
  category: DirectCostCategory;
  amount: number;
  ohp_applies: boolean;
  /** Sales tax is added to this amount at the project tax rate. */
  taxable: boolean;
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
