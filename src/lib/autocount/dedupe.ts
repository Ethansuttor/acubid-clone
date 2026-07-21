// Deduplicate detections across overlapping tiles: the same symbol seen by
// two tiles produces two nearly-identical boxes in canvas space. Greedy
// non-maximum suppression keeps the highest-confidence box and drops any
// box that overlaps it strongly or whose center falls within it.

import type { Detection } from "./types";

export function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function centerDist(a: Detection, b: Detection): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

export interface DedupeOptions {
  iouThreshold?: number;
  /** Suppress when centers are closer than this fraction of the mean box edge. */
  centerFraction?: number;
}

export function dedupeDetections(
  detections: Detection[],
  { iouThreshold = 0.4, centerFraction = 0.6 }: DedupeOptions = {}
): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of sorted) {
    const meanEdge = (d.w + d.h) / 2;
    const dup = kept.some(
      (k) => iou(k, d) > iouThreshold || centerDist(k, d) < centerFraction * Math.max(meanEdge, (k.w + k.h) / 2)
    );
    if (!dup) kept.push(d);
  }
  return kept;
}
