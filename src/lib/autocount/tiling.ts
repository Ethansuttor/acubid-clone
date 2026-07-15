// Tile a rendered sheet into overlapping crops sized for vision models.
// Pure and unit-tested: tiles fully cover the canvas, respect the max tile
// size, and adjacent tiles overlap by at least `overlap` px so symbols on
// seams are seen whole by at least one tile.

import type { Box } from "./types";

export interface TilingOptions {
  tileSize?: number; // max tile edge, px
  overlap?: number;  // min overlap between adjacent tiles, px
}

export function computeTiles(
  width: number,
  height: number,
  { tileSize = 1280, overlap = 160 }: TilingOptions = {}
): Box[] {
  if (width <= 0 || height <= 0) return [];
  if (overlap >= tileSize) throw new Error("overlap must be smaller than tileSize");

  const positions = (extent: number): number[] => {
    if (extent <= tileSize) return [0];
    const step = tileSize - overlap;
    const count = Math.ceil((extent - tileSize) / step) + 1;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      // Clamp the last tile to the edge instead of spilling past it.
      out.push(Math.min(i * step, extent - tileSize));
    }
    return [...new Set(out)];
  };

  const tiles: Box[] = [];
  for (const y of positions(height)) {
    for (const x of positions(width)) {
      tiles.push({
        x,
        y,
        w: Math.min(tileSize, width),
        h: Math.min(tileSize, height),
      });
    }
  }
  return tiles;
}
