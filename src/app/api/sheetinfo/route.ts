// Sheet analysis endpoint: reads title blocks so sheets can name and
// calibrate themselves. Returns proposals only — the estimator confirms
// each one before it changes a sheet.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

async function authorize(req: NextRequest): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "1") return true;
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
      {
        error:
          "ANTHROPIC_API_KEY is not configured on the server. Add it to .env.local to enable sheet analysis.",
      },
      { status: 503 }
    );
  }

  let body: SheetRequest;
  try {
    body = (await req.json()) as SheetRequest;
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
