// Claude-vision implementation of SymbolDetector. Server-side only.
// The prompt strategy and model are isolated here so they can be swapped
// without touching tiling, dedup, or the review UI.

import Anthropic from "@anthropic-ai/sdk";
import type { Detection, SymbolDetector, TileHint } from "./types";
import { cellOffsetToTilePx } from "./grid";

// Spec default: claude-sonnet-4-6 or better; override with ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-sonnet-4-6";

function dataUrlParts(dataUrl: string): { mediaType: "image/png" | "image/jpeg"; data: string } {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/s);
  if (!m) throw new Error("Expected a base64 PNG/JPEG data URL");
  return { mediaType: m[1] as "image/png" | "image/jpeg", data: m[2] };
}

/**
 * Extract a detection array from model output. Tolerates prose or code
 * fences around the JSON. Accepts both cell+offset ({"cell":"C4","dx":40,"dy":90})
 * and absolute pixel coordinates ({"x":100,"y":200}).
 * Returns [] when no valid array is present.
 */
export function parseDetections(
  text: string,
  tileW: number,
  tileH: number
): Detection[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Detection[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    let x = Number(o.x);
    let y = Number(o.y);

    if ((!Number.isFinite(x) || !Number.isFinite(y)) && typeof o.cell === "string") {
      const dx = Number(o.dx ?? 0);
      const dy = Number(o.dy ?? 0);
      const pt = cellOffsetToTilePx(o.cell, dx, dy);
      if (pt) {
        x = pt.x;
        y = pt.y;
      }
    }

    const w = Number(o.w ?? o.width);
    const h = Number(o.h ?? o.height);
    let confidence = Number(o.confidence);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    // clamp to tile bounds; drop boxes fully outside
    if (x + w < 0 || y + h < 0 || x > tileW || y > tileH) continue;
    out.push({
      x: Math.max(0, Math.min(x, tileW)),
      y: Math.max(0, Math.min(y, tileH)),
      w,
      h,
      confidence,
    });
  }
  return out;
}

export class ClaudeDetector implements SymbolDetector {
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async detectInTile(templatePng: string, tilePng: string, hint: TileHint): Promise<Detection[]> {
    const template = dataUrlParts(templatePng);
    const tile = dataUrlParts(tilePng);

    const userContent: Anthropic.MessageParam["content"] = [
      { type: "text", text: "TARGET SYMBOL (cropped from the same plan set):" },
      {
        type: "image",
        source: { type: "base64", media_type: template.mediaType, data: template.data },
      },
      {
        type: "text",
        text:
          `The target symbol is about ${Math.round(hint.templateW)}x${Math.round(hint.templateH)} pixels. ` +
          "Below is a crop of the plan drawing at the same scale.",
      },
      {
        type: "image",
        source: { type: "base64", media_type: tile.mediaType, data: tile.data },
      },
    ];

    if (hint.griddedTilePng) {
      const gridded = dataUrlParts(hint.griddedTilePng);
      userContent.push(
        {
          type: "text",
          text:
            "Below is the EXACT SAME tile crop annotated with a 128px red reference grid. " +
            "Columns are labeled A, B, C, D... and rows are labeled 1, 2, 3, 4...",
        },
        {
          type: "image",
          source: { type: "base64", media_type: gridded.mediaType, data: gridded.data },
        }
      );
    }

    userContent.push({
      type: "text",
      text:
        "Find EVERY instance of the target symbol in the plan crop, including rotated " +
        "or mirrored instances. Match the symbol's distinctive shape; ignore text labels, " +
        "dimension lines, and similar-but-different symbols.\n" +
        "Respond with ONLY a JSON array. Each element: " +
        '{"cell": "<e.g. C4>", "dx": <px offset within cell>, "dy": <px offset within cell>, "w": <width px>, "h": <height px>, "confidence": <0..1>} ' +
        '(or {"x": <left px>, "y": <top px>, "w": <width px>, "h": <height px>, "confidence": <0..1>}) in pixel coordinates ' +
        `of the plan crop (width ${Math.round(hint.tileW)}, height ${Math.round(hint.tileH)}). ` +
        "Return [] if the symbol does not appear.",
    });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system:
        "You are a construction-drawing takeoff assistant that locates electrical symbols " +
        "on plan drawings with pixel precision. You respond with JSON only.",
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return parseDetections(text, hint.tileW, hint.tileH);
  }
}
