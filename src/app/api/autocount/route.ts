// AI auto-count endpoint: receives an example-symbol crop plus overlapping
// tiles of the rendered sheet, runs the symbol detector on each tile, maps
// detections into sheet canvas space, dedupes across tile overlaps, and
// returns candidates. The caller stores them as PENDING takeoffs — nothing
// is counted until the estimator confirms in the review queue.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ClaudeDetector } from "@/lib/autocount/claude";
import { dedupeDetections } from "@/lib/autocount/dedupe";
import type { DetectRequest, Detection, SymbolDetector } from "@/lib/autocount/types";

export const maxDuration = 300;

const MAX_TILES = 40;
const CONCURRENCY = 4;

/** Largest request body accepted, in bytes. Each tile is a base64 image. */
const MAX_BODY_BYTES = 48 * 1024 * 1024;

async function authorize(req: NextRequest): Promise<boolean> {
  // Local mode is an offline dev/test configuration. Guarding on NODE_ENV too
  // means a stray env var in a deployment cannot disable auth on this route.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_LOCAL_MODE === "1"
  ) {
    return true;
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local to enable AI auto-count." },
      { status: 503 }
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Request too large (${Math.round(declared / 1e6)} MB). Reduce the render scale or work sheet by sheet.` },
      { status: 413 }
    );
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  let body: DetectRequest;
  try {
    body = JSON.parse(raw) as DetectRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.template || !Array.isArray(body.tiles) || body.tiles.length === 0) {
    return NextResponse.json({ error: "template and tiles are required" }, { status: 400 });
  }
  if (body.tiles.length > MAX_TILES) {
    return NextResponse.json(
      { error: `Too many tiles (${body.tiles.length} > ${MAX_TILES}). Zoom in or use a smaller sheet region.` },
      { status: 400 }
    );
  }

  const detector: SymbolDetector = new ClaudeDetector(apiKey);

  const all: Detection[] = [];
  const errors: string[] = [];
  let index = 0;
  async function worker() {
    while (index < body.tiles.length) {
      const i = index++;
      const tile = body.tiles[i];
      try {
        const found = await detector.detectInTile(body.template, tile.image, {
          templateW: body.templateW,
          templateH: body.templateH,
          tileW: tile.w,
          tileH: tile.h,
        });
        for (const d of found) {
          all.push({ ...d, x: d.x + tile.x, y: d.y + tile.y });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, body.tiles.length) }, worker));

  if (all.length === 0 && errors.length === body.tiles.length) {
    return NextResponse.json(
      { error: `Detection failed on all tiles: ${errors[0]}` },
      { status: 502 }
    );
  }

  const detections = dedupeDetections(all);
  return NextResponse.json({
    detections,
    tilesProcessed: body.tiles.length - errors.length,
    model: detector.model,
    warnings: errors.length ? [`${errors.length} tile(s) failed`] : [],
  });
}
