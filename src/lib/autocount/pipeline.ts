"use client";

import { toGray } from "./ncc";
import { computeTiles } from "./tiling";
import { dedupeDetections } from "./dedupe";
import { createLocalMatcher } from "./worker-client";
import { AI_BATCH_SIZE, chooseAiCandidates, MAX_LOCAL_CANDIDATES, validVerificationMap, type LocalOptions } from "./local";
import type { Detection, VerificationResult } from "./types";

export interface ReviewedDetection extends Detection { review: "local" | "match" | "no-match" | "unresolved" }
export interface DetectionProgress { stage: "local" | "ai"; completed: number; total: number }
export interface PipelineOptions extends LocalOptions {
  minScore: number;
  assist: boolean;
  authHeader?: string;
  existing: { x: number; y: number }[];
}

export function cropCanvas(src: HTMLCanvasElement, x: number, y: number, w: number, h: number, maxEdge?: number): HTMLCanvasElement {
  const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
  const width = Math.max(1, Math.min(src.width - left, Math.ceil(w)));
  const height = Math.max(1, Math.min(src.height - top, Math.ceil(h)));
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(width, height)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")!.drawImage(src, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function detectOnCanvas(
  canvas: HTMLCanvasElement,
  template: HTMLCanvasElement,
  options: PipelineOptions,
  signal: AbortSignal,
  progress: (value: DetectionProgress) => void,
) {
  const matcher = createLocalMatcher(signal);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const overlap = Math.min(640, Math.max(160, Math.ceil(2.3 * Math.max(template.width, template.height))));
  const tiles = computeTiles(canvas.width, canvas.height, { tileSize: 1280, overlap });
  let candidates: Detection[] = [];
  let skipped = 0;
  try {
    const pixels = template.getContext("2d")!.getImageData(0, 0, template.width, template.height);
    await matcher.init({ g: toGray(pixels.data, template.width, template.height), w: template.width, h: template.height }, options);
    for (let i = 0; i < tiles.length; i++) {
      signal.throwIfAborted();
      progress({ stage: "local", completed: i, total: tiles.length });
      const tile = tiles[i];
      const rgba = ctx.getImageData(tile.x, tile.y, tile.w, tile.h);
      const g = toGray(rgba.data, tile.w, tile.h);
      // Only uniform tiles cannot match a contrasted template. A brightness
      // cutoff discards faint linework even though NCC is brightness-invariant.
      if (!g.some(pixel => pixel !== g[0])) { skipped++; continue; }
      const hits = await matcher.match({ g, w: tile.w, h: tile.h }, options.minScore);
      candidates = dedupeDetections([...candidates, ...hits.map(hit => ({ ...hit, x: hit.x + tile.x, y: hit.y + tile.y }))], { centerFraction: 0.35 });
      if (candidates.length > MAX_LOCAL_CANDIDATES) throw new Error("More than 2,500 candidates found. Raise the match threshold or select a more distinctive symbol. No partial results were added.");
    }
    progress({ stage: "local", completed: tiles.length, total: tiles.length });
  } finally { matcher.close(); }
  signal.throwIfAborted();
  const before = candidates.length;
  candidates = candidates.filter(candidate => !options.existing.some(point => Math.hypot(point.x - candidate.x - candidate.w / 2, point.y - candidate.y - candidate.h / 2) < 0.35 * Math.min(candidate.w, candidate.h)));
  const detections: ReviewedDetection[] = candidates.map(candidate => ({ ...candidate, review: "local" }));
  let sentCrops = 0, requests = 0, payloadBytes = 0;
  let model = "Local image matcher";
  let warning = "";
  if (options.assist) {
    const selected = chooseAiCandidates(candidates);
    selected.forEach(index => { detections[index].review = "unresolved"; });
    const templatePng = cropCanvas(template, 0, 0, template.width, template.height, 192).toDataURL("image/png");
    const cache = new Map<string, VerificationResult>();
    for (let offset = 0; offset < selected.length; offset += AI_BATCH_SIZE) {
      signal.throwIfAborted();
      progress({ stage: "ai", completed: offset, total: selected.length });
      const batch = selected.slice(offset, offset + AI_BATCH_SIZE).map(index => {
        const box = candidates[index];
        const w = Math.min(canvas.width, Math.ceil(box.w * 1.6)), h = Math.min(canvas.height, Math.ceil(box.h * 1.6));
        const x = Math.max(0, Math.min(canvas.width - w, Math.round(box.x + box.w / 2 - w / 2)));
        const y = Math.max(0, Math.min(canvas.height - h, Math.round(box.y + box.h / 2 - h / 2)));
        return { index, image: cropCanvas(canvas, x, y, w, h, 192).toDataURL("image/png") };
      });
      const unique = batch.filter((crop, i) => !cache.has(crop.image) && batch.findIndex(other => other.image === crop.image) === i);
      try {
        if (unique.length) {
          const body = JSON.stringify({ mode: "verify", template: templatePng, crops: unique });
          payloadBytes += new TextEncoder().encode(body).length;
          requests++;
          sentCrops += unique.length;
          const res = await fetch("/api/autocount", { method: "POST", headers: { "content-type": "application/json", authorization: options.authHeader ?? "" }, body, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
          if (!res.ok) throw new Error(`Optional AI review unavailable (HTTP ${res.status}).`);
          const result = await res.json();
          const valid = validVerificationMap(result.verifications, unique.map(crop => crop.index));
          if (typeof result.model === "string") model = result.model;
          for (const crop of unique) {
            const decision = valid.get(crop.index);
            if (decision) cache.set(crop.image, decision);
          }
        }
        for (const crop of batch) {
          const decision = cache.get(crop.image);
          if (decision) detections[crop.index].review = decision.match ? "match" : "no-match";
        }
      } catch (error) {
        signal.throwIfAborted();
        warning = `${error instanceof Error ? error.message : "Optional AI review failed."} All local candidates are available for your review.`;
        break; // No automatic retries, escalation or unbounded spending.
      }
    }
  }
  return { detections, model, warning, stats: { tiles: tiles.length, skipped, duplicates: before - candidates.length, sentCrops, requests, payloadBytes } };
}
