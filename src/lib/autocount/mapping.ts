// Pure coordinate mapping for AI auto-count detections.
// Converts tile-local pixel detections + tile canvas origin + render scale S
// into sheet coordinates (PDF user-space units at scale 1).

import type { Box, Detection } from "./types";

/**
 * Returns the center point (x, y) of an axis-aligned box.
 */
export function detectionCenter(box: Box): { x: number; y: number } {
  return {
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
  };
}

/**
 * Maps a single detection in tile-local pixel space to a point in sheet coordinates.
 */
export function mapDetectionToPoint(
  detection: Box,
  tileOrigin: { x: number; y: number },
  S: number
): { x: number; y: number } {
  if (S <= 0) throw new Error("Render scale S must be greater than 0");
  return {
    x: (tileOrigin.x + detection.x + detection.w / 2) / S,
    y: (tileOrigin.y + detection.y + detection.h / 2) / S,
  };
}

/**
 * Maps an array of detections from tile-local pixel space to sheet coordinates (PDF scale 1).
 *
 * @param detections Detections with positions (x, y, w, h) in tile-local pixels.
 * @param tileOrigin The top-left (x, y) of the tile in rendered canvas pixel space.
 * @param S The render scale (canvas pixels per PDF point).
 */
export function mapDetectionsToSheet(
  detections: Detection[],
  tileOrigin: { x: number; y: number } = { x: 0, y: 0 },
  S: number = 1
): Detection[] {
  if (S <= 0) throw new Error("Render scale S must be greater than 0");
  return detections.map((d) => ({
    x: (tileOrigin.x + d.x) / S,
    y: (tileOrigin.y + d.y) / S,
    w: d.w / S,
    h: d.h / S,
    confidence: d.confidence,
  }));
}
