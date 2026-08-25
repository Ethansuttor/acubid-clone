// Claude-vision implementation of SheetAnalyzer. Server-side only.

import Anthropic from "@anthropic-ai/sdk";
import type { SheetAnalyzer, SheetInfo } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

function dataUrlParts(dataUrl: string): { mediaType: "image/png" | "image/jpeg"; data: string } {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/s);
  if (!m) throw new Error("Expected a base64 PNG/JPEG data URL");
  return { mediaType: m[1] as "image/png" | "image/jpeg", data: m[2] };
}

/** Tolerant extraction of the JSON object from model output. */
export function parseSheetInfo(text: string): SheetInfo {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const empty: SheetInfo = {
    sheetNumber: null,
    sheetTitle: null,
    scaleText: null,
    confidence: 0,
  };
  if (start === -1 || end <= start) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (typeof raw !== "object" || raw === null) return empty;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" || t.toLowerCase() === "null" ? null : t;
  };
  let confidence = Number(o.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  return {
    sheetNumber: str(o.sheetNumber ?? o.sheet_number),
    sheetTitle: str(o.sheetTitle ?? o.sheet_title),
    scaleText: str(o.scaleText ?? o.scale_text ?? o.scale),
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

export class ClaudeSheetAnalyzer implements SheetAnalyzer {
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async analyzeSheet(pngDataUrl: string): Promise<SheetInfo> {
    const img = dataUrlParts(pngDataUrl);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system:
        "You read construction drawing title blocks. You respond with JSON only.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            },
            {
              type: "text",
              text:
                "This is one sheet of a construction plan set. Read its title block " +
                "(usually along the right edge or bottom) and the drawing scale.\n" +
                "Respond with ONLY this JSON object:\n" +
                '{"sheetNumber": "<e.g. E-101, or null>", ' +
                '"sheetTitle": "<e.g. POWER PLAN - LEVEL 1, or null>", ' +
                '"scaleText": "<the scale exactly as printed, e.g. 1/4\\" = 1\'-0\\", ' +
                'or NTS, or null if none is shown>", ' +
                '"confidence": <0..1>}\n' +
                "Copy the scale verbatim; do not convert or normalize it. If the sheet " +
                "shows several scales for different details, give the one for the main " +
                "plan view. Use null rather than guessing.",
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseSheetInfo(text);
  }
}
