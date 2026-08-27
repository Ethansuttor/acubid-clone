// AI auto-count endpoint: supports two modes:
// 1. "verify" (default/GA-6): receives an example-symbol template plus candidate crops (up to 24),
//    runs ClaudeVerifier to verify each crop without coordinate guessing, and returns match decisions.
// 2. "detect" (legacy): receives whole sheet tiles, runs ClaudeDetector, and returns pixel detections.

import { NextRequest, NextResponse } from "next/server";
import { ClaudeDetector } from "@/lib/autocount/claude";
import { ClaudeVerifier } from "@/lib/autocount/verify";
import { dedupeDetections } from "@/lib/autocount/dedupe";
import type {
  AutoCountRequest,
  DetectRequest,
  Detection,
  SymbolDetector,
  SymbolVerifier,
  VerifyRequest,
} from "@/lib/autocount/types";

export const maxDuration = 300;

const MAX_TILES = 40;
const MAX_CROPS_PER_REQUEST = 24;
const CONCURRENCY = 4;

/** Largest request body accepted, in bytes. Each tile/crop is a base64 image. */
const MAX_BODY_BYTES = 48 * 1024 * 1024;

async function authorize(req: NextRequest): Promise<boolean> {
  // The temporary local token is only valid on the development server. A
  // production deployment must fail closed until real authentication returns.
  if (process.env.NODE_ENV === "production") return false;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === "local";
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
      { error: `Request too large (${Math.round(declared / 1e6)} MB). Reduce the render scale or batch size.` },
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

  let body: AutoCountRequest;
  try {
    body = JSON.parse(raw) as AutoCountRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- MODE 1: VERIFY CROPS (GA-6) ----------------------------------------
  if ("mode" in body && body.mode === "verify") {
    const verifyReq = body as VerifyRequest;
    if (!verifyReq.template || typeof verifyReq.template !== "string") {
      return NextResponse.json({ error: "template image is required" }, { status: 400 });
    }
    if (!Array.isArray(verifyReq.crops) || verifyReq.crops.length === 0) {
      return NextResponse.json({ error: "crops array is required and must not be empty" }, { status: 400 });
    }
    if (verifyReq.crops.length > MAX_CROPS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many crops in single batch (${verifyReq.crops.length} > ${MAX_CROPS_PER_REQUEST})` },
        { status: 400 }
      );
    }

    const verifier: SymbolVerifier = new ClaudeVerifier(apiKey);
    try {
      const verifications = await verifier.verifyCrops(verifyReq.template, verifyReq.crops);
      return NextResponse.json({
        verifications,
        model: verifier.model,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Verification failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 }
      );
    }
  }

  // ---- MODE 2: WHOLE-TILE DETECT (LEGACY) --------------------------------
  const detectReq = body as DetectRequest;
  if (!detectReq.template || !Array.isArray(detectReq.tiles) || detectReq.tiles.length === 0) {
    return NextResponse.json({ error: "template and tiles are required" }, { status: 400 });
  }
  if (detectReq.tiles.length > MAX_TILES) {
    return NextResponse.json(
      { error: `Too many tiles (${detectReq.tiles.length} > ${MAX_TILES}). Zoom in or use a smaller sheet region.` },
      { status: 400 }
    );
  }

  const detector: SymbolDetector = new ClaudeDetector(apiKey);

  const all: Detection[] = [];
  const errors: string[] = [];
  let index = 0;
  async function worker() {
    while (index < detectReq.tiles.length) {
      const i = index++;
      const tile = detectReq.tiles[i];
      try {
        const found = await detector.detectInTile(detectReq.template, tile.image, {
          templateW: detectReq.templateW,
          templateH: detectReq.templateH,
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
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, detectReq.tiles.length) }, worker));

  if (all.length === 0 && errors.length === detectReq.tiles.length) {
    return NextResponse.json(
      { error: `Detection failed on all tiles: ${errors[0]}` },
      { status: 502 }
    );
  }

  const detections = dedupeDetections(all);
  return NextResponse.json({
    detections,
    tilesProcessed: detectReq.tiles.length - errors.length,
    model: detector.model,
    warnings: errors.length ? [`${errors.length} tile(s) failed`] : [],
  });
}
