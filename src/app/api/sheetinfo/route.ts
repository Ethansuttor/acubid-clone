// Sheet analysis endpoint: reads title blocks so sheets can name and
// calibrate themselves. Returns proposals only — the estimator confirms
// each one before it changes a sheet.

import { NextRequest, NextResponse } from "next/server";
import { ClaudeSheetAnalyzer } from "@/lib/sheetai/claude";
import { parseDrawingScale } from "@/lib/sheetai/scale";
import type { SheetAnalyzer, SheetInfo } from "@/lib/sheetai/types";

export const maxDuration = 300;

const MAX_SHEETS = 40;
const CONCURRENCY = 4;

interface SheetRequest {
  sheets: { id: string; image: string }[];
}

export interface SheetProposal extends SheetInfo {
  id: string;
  /** Feet per inch of paper derived from scaleText, null when unusable. */
  feetPerInch: number | null;
  error?: string;
}

/** Largest request body accepted, in bytes. Each entry is a base64 image. */
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
      {
        error:
          "ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local to enable sheet analysis.",
      },
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

  let body: SheetRequest;
  try {
    body = JSON.parse(raw) as SheetRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.sheets) || body.sheets.length === 0) {
    return NextResponse.json({ error: "sheets are required" }, { status: 400 });
  }
  if (body.sheets.length > MAX_SHEETS) {
    return NextResponse.json(
      { error: `Too many sheets (${body.sheets.length} > ${MAX_SHEETS})` },
      { status: 400 }
    );
  }

  const analyzer: SheetAnalyzer = new ClaudeSheetAnalyzer(apiKey);
  const proposals: SheetProposal[] = [];
  let index = 0;
  async function worker() {
    while (index < body.sheets.length) {
      const sheet = body.sheets[index++];
      try {
        const info = await analyzer.analyzeSheet(sheet.image);
        proposals.push({
          ...info,
          id: sheet.id,
          feetPerInch: info.scaleText ? parseDrawingScale(info.scaleText) : null,
        });
      } catch (e) {
        proposals.push({
          id: sheet.id,
          sheetNumber: null,
          sheetTitle: null,
          scaleText: null,
          confidence: 0,
          feetPerInch: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, body.sheets.length) }, worker)
  );

  return NextResponse.json({ proposals, model: analyzer.model });
}
