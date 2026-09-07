#!/usr/bin/env python3
"""
Renders a chosen page of an electrical plan at scale S, crops the target template symbol,
computes overlapping tile boxes identical to computeTiles(), filters blank tiles,
and writes eval-out/manifest.json with all tile and template PNG and raw grayscale paths.
"""

import argparse
import json
import math
import os
import pypdfium2 as pdfium
from PIL import Image


def compute_tiles(width, height, tile_size=1280, overlap=160):
    """
    Python port of src/lib/autocount/tiling.ts computeTiles().
    Tiles fully cover the canvas with minimum overlap.
    """
    if width <= 0 or height <= 0:
        return []
    if overlap >= tile_size:
        raise ValueError("overlap must be smaller than tile_size")

    def positions(extent):
        if extent <= tile_size:
            return [0]
        step = tile_size - overlap
        count = math.ceil((extent - tile_size) / step) + 1
        out = []
        for i in range(count):
            out.append(min(i * step, extent - tile_size))
        # Deduplicate preserving order
        seen = set()
        deduped = []
        for p in out:
            if p not in seen:
                seen.add(p)
                deduped.append(p)
        return deduped

    tiles = []
    for y in positions(height):
        for x in positions(width):
            tiles.append({
                "x": x,
                "y": y,
                "w": min(tile_size, width),
                "h": min(tile_size, height),
            })
    return tiles


def is_blank(tile_img):
    """
    Python port of AutoCount.tsx isBlank() sampled darkness check.
    """
    img = tile_img.convert("RGBA")
    data = img.tobytes()
    dark = 0
    # Every 8th pixel (RGBA stride 32 bytes)
    for i in range(0, len(data), 32):
        r, g, b, a = data[i], data[i + 1], data[i + 2], data[i + 3]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum < 200 and a > 0:
            dark += 1
            if dark > 5:
                return False
    return True


def save_gray_bin(pil_img, out_path):
    g = pil_img.convert("L")
    with open(out_path, "wb") as f:
        f.write(g.tobytes())


def main():
    parser = argparse.ArgumentParser(description="Render evaluation tiles for auto-count")
    parser.add_argument("--pdf", default="test-assets/sample-plan-E101-E102.pdf", help="Path to PDF")
    parser.add_argument("--truth", default="test-assets/sample-plan-truth.json", help="Path to truth JSON")
    parser.add_argument("--page", type=int, default=2, help="Page number (1-indexed)")
    parser.add_argument("--symbol", default="troffer", help="Symbol kind (troffer, duplex, switch, exit)")
    parser.add_argument("--scale", type=float, default=None, help="Render scale S (default auto ~72px template)")
    parser.add_argument("--out-dir", default="eval-out", help="Output directory")
    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    pdf_path = os.path.abspath(os.path.join(project_root, args.pdf)) if not os.path.isabs(args.pdf) else args.pdf
    truth_path = os.path.abspath(os.path.join(project_root, args.truth)) if not os.path.isabs(args.truth) else args.truth
    out_dir = os.path.abspath(os.path.join(project_root, args.out_dir)) if not os.path.isabs(args.out_dir) else args.out_dir

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if not os.path.exists(truth_path):
        raise FileNotFoundError(f"Truth JSON not found: {truth_path}")

    with open(truth_path, "r", encoding="utf-8") as f:
        truth_data = json.load(f)

    # Find matching sheet
    sheet = None
    for s in truth_data.get("sheets", []):
        if s.get("page_number") == args.page:
            sheet = s
            break
    if not sheet:
        raise ValueError(f"Sheet for page {args.page} not found in {truth_path}")

    # Find target symbol template from ground truth
    target_sym = None
    for sym in sheet.get("symbols", []):
        if sym.get("kind") == args.symbol:
            target_sym = sym
            break
    if not target_sym:
        raise ValueError(f"No symbol of kind '{args.symbol}' found on page {args.page}")

    sym_w = target_sym["w"]
    sym_h = target_sym["h"]
    # Symbol center in PDF top-down points
    sym_cx = target_sym["x"]
    sym_cy = target_sym["y"]

    # Calculate scale S if not provided
    if args.scale is not None:
        S = args.scale
    else:
        # Template ~72px on long edge, clamped to [1.5, 4.0]
        S = min(4.0, max(1.5, 72.0 / max(sym_w, sym_h)))

    print(f"Loading PDF: {pdf_path}, Page: {args.page} ({sheet.get('sheet_no')})")
    print(f"Target symbol: '{args.symbol}' at center ({sym_cx}, {sym_cy}), size {sym_w}x{sym_h} pt, scale S={S:.4f}")

    pdf = pdfium.PdfDocument(pdf_path)
    page_idx = args.page - 1
    if page_idx < 0 or page_idx >= len(pdf):
        raise ValueError(f"Page {args.page} out of range (PDF has {len(pdf)} pages)")

    page = pdf[page_idx]
    # Render page to PIL Image
    pil_img = page.render(scale=S).to_pil()
    canvas_w, canvas_h = pil_img.size
    print(f"Rendered canvas size: {canvas_w}x{canvas_h} px")

    # Crop template with 10% padding
    x0 = sym_cx - sym_w / 2.0
    y0 = sym_cy - sym_h / 2.0
    pad = 0.1 * max(sym_w, sym_h) * S
    tx = max(0, int(round(x0 * S - pad)))
    ty = max(0, int(round(y0 * S - pad)))
    tw = min(canvas_w - tx, int(round(sym_w * S + 2 * pad)))
    th = min(canvas_h - ty, int(round(sym_h * S + 2 * pad)))

    template_crop = pil_img.crop((tx, ty, tx + tw, ty + th))

    tiles_dir = os.path.join(out_dir, "tiles")
    os.makedirs(tiles_dir, exist_ok=True)

    template_path = os.path.join(out_dir, "template.png")
    template_bin_path = os.path.join(out_dir, "template.gray.bin")
    template_crop.save(template_path, format="PNG")
    save_gray_bin(template_crop, template_bin_path)
    print(f"Saved template: {template_path} ({tw}x{th} px)")

    # Save full canvas gray bin for fast patch extraction
    canvas_bin_path = os.path.join(out_dir, "canvas.gray.bin")
    save_gray_bin(pil_img, canvas_bin_path)

    # Compute tiles
    overlap = min(640, max(160, int(math.ceil(2 * max(sym_w, sym_h) * S))))
    raw_tiles = compute_tiles(canvas_w, canvas_h, tile_size=1280, overlap=overlap)
    print(f"Computed {len(raw_tiles)} raw tiles (tileSize=1280, overlap={overlap})")

    active_tiles = []
    tile_idx = 0
    for b in raw_tiles:
        tile_crop = pil_img.crop((b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
        if is_blank(tile_crop):
            continue
        rel_tile_path = f"tiles/tile_{tile_idx}.png"
        rel_tile_bin = f"tiles/tile_{tile_idx}.gray.bin"
        abs_tile_path = os.path.join(out_dir, rel_tile_path)
        abs_tile_bin = os.path.join(out_dir, rel_tile_bin)

        tile_crop.save(abs_tile_path, format="PNG")
        save_gray_bin(tile_crop, abs_tile_bin)

        active_tiles.append({
            "index": tile_idx,
            "x": b["x"],
            "y": b["y"],
            "w": b["w"],
            "h": b["h"],
            "path": rel_tile_path,
            "binPath": rel_tile_bin,
        })
        tile_idx += 1

    print(f"Saved {len(active_tiles)} active (non-blank) tiles to {tiles_dir}")

    manifest = {
        "pdf": os.path.relpath(pdf_path, out_dir),
        "page": args.page,
        "sheet_no": sheet.get("sheet_no"),
        "scale": S,
        "symbol": args.symbol,
        "canvas": {
            "w": canvas_w,
            "h": canvas_h,
            "binPath": "canvas.gray.bin",
        },
        "template": {
            "path": "template.png",
            "binPath": "template.gray.bin",
            "w": tw,
            "h": th,
            "pageBox": {
                "x": x0,
                "y": y0,
                "w": sym_w,
                "h": sym_h,
            },
        },
        "tiles": active_tiles,
    }

    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"Wrote manifest: {manifest_path}")


if __name__ == "__main__":
    main()
