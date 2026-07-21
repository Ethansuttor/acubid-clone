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
  created_at: string;
  updated_at: string;
}

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
