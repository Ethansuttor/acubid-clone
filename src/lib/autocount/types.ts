// AI auto-count module. Structured with narrow interfaces (SymbolDetector, SymbolVerifier)
// so detection and verification strategies can be swapped without touching the takeoff UI.

/** The product defaults to local matching. Legacy strategies remain available to evaluation scripts. */
export const DETECTION_STRATEGY = "local" as const;

export type DetectionStrategy = "local" | "ncc-verify" | "tile-scan";

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
  mode?: "detect";
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
  griddedTilePng?: string;
}

/** A single numbered candidate crop sent to the verifier */
export interface CandidateCrop {
  index: number;
  /** PNG data URL of the 1.6x candidate crop patch */
  image: string;
  /** The candidate detection box in canvas pixel space */
  box: Detection;
}

export interface VerifyCropItem {
  index: number;
  image: string; // PNG data URL
}

export interface VerifyRequest {
  mode: "verify";
  template: string; // PNG data URL
  crops: VerifyCropItem[];
}

export interface VerificationResult {
  index: number;
  match: boolean;
  confidence: number; // 0..1
}

export interface VerifyResponse {
  verifications: VerificationResult[];
  model: string;
}

export interface SymbolVerifier {
  readonly model: string;
  verifyCrops(templatePng: string, crops: VerifyCropItem[]): Promise<VerificationResult[]>;
}

export type AutoCountRequest = DetectRequest | VerifyRequest;
