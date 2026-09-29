#!/usr/bin/env python3
"""
Crops 1.6x template-sized patches around candidate detection centers from the rendered PDF page.
"""

import argparse
import json
import os
import pypdfium2 as pdfium
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description="Crop candidate patches for verification")
    parser.add_argument("--manifest", default="eval-out/manifest.json", help="Manifest JSON")
    parser.add_argument("--candidates", default="eval-out/ncc-candidates.json", help="Candidates JSON")
    parser.add_argument("--out-dir", default="eval-out/crops", help="Output crops directory")
    args = parser.parse_args()

    with open(args.manifest, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    with open(args.candidates, "r", encoding="utf-8") as f:
        candidates = json.load(f)

    manifest_dir = os.path.dirname(os.path.abspath(args.manifest))
    pdf_path = os.path.abspath(os.path.join(manifest_dir, manifest["pdf"]))
    os.makedirs(args.out_dir, exist_ok=True)

    pdf = pdfium.PdfDocument(pdf_path)
    page = pdf[manifest["page"] - 1]
    pil_img = page.render(scale=manifest["scale"]).to_pil()
    canvas_w, canvas_h = pil_img.size

    tw = manifest["template"]["w"]
    th = manifest["template"]["h"]
    crop_w = max(1, min(canvas_w, int(round(1.6 * tw))))
    crop_h = max(1, min(canvas_h, int(round(1.6 * th))))

    crops_manifest = []
    for idx, c in enumerate(candidates):
        cx = c["x"] + c["w"] / 2.0
        cy = c["y"] + c["h"] / 2.0
        x0 = max(0, min(canvas_w - crop_w, int(round(cx - crop_w / 2.0))))
        y0 = max(0, min(canvas_h - crop_h, int(round(cy - crop_h / 2.0))))

        patch = pil_img.crop((x0, y0, x0 + crop_w, y0 + crop_h))
        crop_filename = f"crop_{idx + 1}.png"
        crop_path = os.path.join(args.out_dir, crop_filename)
        patch.save(crop_path, format="PNG")

        crops_manifest.append({
            "index": idx + 1,
            "path": os.path.relpath(crop_path, manifest_dir),
            "box": c,
        })

    out_json = os.path.join(args.out_dir, "manifest.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(crops_manifest, f, indent=2)

    print(f"Cropped {len(crops_manifest)} patches to {args.out_dir}")


if __name__ == "__main__":
    main()
