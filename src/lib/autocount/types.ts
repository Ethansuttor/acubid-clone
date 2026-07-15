// AI auto-count module. Structured as its own module with a narrow
// interface (SymbolDetector) so the model or prompting strategy can be
// swapped without touching the takeoff UI.

/** Axis-aligned box; units depend on context (tile px or PDF units). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection extends Box {
  confidence: number; // 0..1
}

/** A crop of the rendered sheet sent to the detector. */
export interface Tile extends Box {
  /** PNG data URL of the tile image. */
  image: string;
}

export interface DetectRequest {
  /** PNG data URL of the example symbol crop. */
  template: string;
  /** Template size in rendered pixels (for scale hints in the prompt). */
  templateW: number;
  templateH: number;
  /** Tiles in rendered-canvas pixel space. */
  tiles: Tile[];
}

export interface DetectResponse {
  /** Deduplicated detections in rendered-canvas pixel space. */
  detections: Detection[];
  tilesProcessed: number;
  model: string;
}

/** One tile in, detections (in that tile's local pixel space) out. */
export interface SymbolDetector {
  readonly model: string;
  detectInTile(templatePng: string, tilePng: string, hint: TileHint): Promise<Detection[]>;
}

export interface TileHint {
  templateW: number;
  templateH: number;
  tileW: number;
  tileH: number;
}
