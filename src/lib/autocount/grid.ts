// Grid anchoring for AI symbol detection (GA-4).
// Draws 128px reference gridlines labeled columns A-J and rows 1-10.

export const GRID_CELL_SIZE = 128;

export interface GridCellCoords {
  cell: string; // e.g. "C4"
  dx: number;   // 0..128 offset inside cell
  dy: number;   // 0..128 offset inside cell
}

/**
 * Converts a grid cell label and offset (e.g. "C4", dx: 40, dy: 90) to tile-local pixel coordinates.
 * Column A=0, B=1, C=2... Row 1=0, 2=1, 3=2, 4=3...
 */
export function cellOffsetToTilePx(
  cell: string,
  dx: number,
  dy: number,
  cellSize: number = GRID_CELL_SIZE
): { x: number; y: number } | null {
  if (!cell || typeof cell !== "string") return null;
  const match = cell.trim().toUpperCase().match(/^([A-Z])(\d+)$/);
  if (!match) return null;

  const colLetter = match[1];
  const rowNum = parseInt(match[2], 10);
  if (isNaN(rowNum) || rowNum < 1) return null;

  const colIdx = colLetter.charCodeAt(0) - 65; // A -> 0
  const rowIdx = rowNum - 1;                   // 1 -> 0

  if (colIdx < 0 || colIdx > 25 || rowIdx < 0) return null;

  return {
    x: colIdx * cellSize + dx,
    y: rowIdx * cellSize + dy,
  };
}

/**
 * Converts tile-local pixel coordinates to grid cell label and offset.
 */
export function tilePxToCellOffset(
  x: number,
  y: number,
  cellSize: number = GRID_CELL_SIZE
): GridCellCoords {
  const colIdx = Math.max(0, Math.floor(x / cellSize));
  const rowIdx = Math.max(0, Math.floor(y / cellSize));
  const colLetter = String.fromCharCode(65 + Math.min(25, colIdx));
  const rowNum = rowIdx + 1;

  return {
    cell: `${colLetter}${rowNum}`,
    dx: x - colIdx * cellSize,
    dy: y - rowIdx * cellSize,
  };
}

/**
 * Pure RGBA buffer grid renderer for pixel-level testing and node/browser canvas.
 * Draws light red (R: 239, G: 68, B: 68, A: 100) 1px lines at 128px intervals.
 */
export function drawGridLinesOnBuffer(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  cellSize: number = GRID_CELL_SIZE
): void {
  // Vertical lines
  for (let x = cellSize; x < width; x += cellSize) {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      data[idx] = 239;     // R
      data[idx + 1] = 68;  // G
      data[idx + 2] = 68;  // B
      data[idx + 3] = 180; // A
    }
  }

  // Horizontal lines
  for (let y = cellSize; y < height; y += cellSize) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 239;     // R
      data[idx + 1] = 68;  // G
      data[idx + 2] = 68;  // B
      data[idx + 3] = 180; // A
    }
  }
}

/**
 * Annotates an HTML canvas or offscreen canvas copy with light red 1px gridlines and cell labels.
 */
export function annotateTileWithGrid<
  T extends { getContext(contextId: "2d"): CanvasRenderingContext2D | null; width: number; height: number }
>(
  canvas: T,
  cellSize: number = GRID_CELL_SIZE
): T {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.4)"; // light red 1px
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgb(220, 38, 38)";        // red text
  ctx.font = "10px sans-serif";

  // Vertical gridlines
  for (let x = cellSize; x < w; x += cellSize) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }

  // Horizontal gridlines
  for (let y = cellSize; y < h; y += cellSize) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  // Cell labels (Columns A-J..., Rows 1-10...)
  for (let r = 0; r * cellSize < h; r++) {
    for (let c = 0; c * cellSize < w; c++) {
      const colLabel = String.fromCharCode(65 + c);
      const rowLabel = String(r + 1);
      const label = `${colLabel}${rowLabel}`;
      ctx.fillText(label, c * cellSize + 4, r * cellSize + 12);
    }
  }

  ctx.restore();
  return canvas;
}
