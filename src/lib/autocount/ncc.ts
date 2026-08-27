// Pure TypeScript Normalized Cross-Correlation (NCC) template matcher (GA-5).
// Zero external dependencies, no DOM imports.
// Sliding zero-mean normalized cross-correlation with integral image acceleration
// and zero-mean feature point sampling.

import type { Detection } from "./types";

export interface GrayImage {
  g: Float32Array;
  w: number;
  h: number;
}

export interface TemplateVariant extends GrayImage {
  angle: number;
  mirrored: boolean;
}

export interface IntegralImages {
  satSum: Float64Array;
  satSq: Float64Array;
  stride: number;
  w: number;
  h: number;
}

/**
 * Converts an RGBA pixel buffer (Uint8ClampedArray or Uint8Array) to grayscale Float32Array.
 * Grayscale formula: 0.299*R + 0.587*G + 0.114*B
 */
export function toGray(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number
): Float32Array {
  const size = w * h;
  const out = new Float32Array(size);
  for (let i = 0, j = 0; i < size; i++, j += 4) {
    out[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return out;
}

/**
 * Generates the 4 orthogonal rotations (0, 90, 180, 270 deg) plus horizontal mirror
 * of a template via Float32Array index remapping.
 */
export function rotations(template: GrayImage): TemplateVariant[] {
  const { g: src, w, h } = template;
  const variants: TemplateVariant[] = [];

  // 0 deg (identity)
  variants.push({
    g: new Float32Array(src),
    w,
    h,
    angle: 0,
    mirrored: false,
  });

  // 90 deg clockwise (w -> h, h -> w)
  const g90 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = h - 1 - y;
      const ny = x;
      g90[ny * h + nx] = src[y * w + x];
    }
  }
  variants.push({ g: g90, w: h, h: w, angle: 90, mirrored: false });

  // 180 deg (w, h)
  const g180 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = w - 1 - x;
      const ny = h - 1 - y;
      g180[ny * w + nx] = src[y * w + x];
    }
  }
  variants.push({ g: g180, w, h, angle: 180, mirrored: false });

  // 270 deg clockwise (w -> h, h -> w)
  const g270 = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = y;
      const ny = w - 1 - x;
      g270[ny * h + nx] = src[y * w + x];
    }
  }
  variants.push({ g: g270, w: h, h: w, angle: 270, mirrored: false });

  // Horizontal mirror (flip X)
  const gMirror = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = w - 1 - x;
      const ny = y;
      gMirror[ny * w + nx] = src[y * w + x];
    }
  }
  variants.push({ g: gMirror, w, h, angle: 0, mirrored: true });

  return variants;
}

/**
 * Precomputes 2D integral images (sum and sum-of-squares) for O(1) window statistics.
 */
export function computeIntegralImages(
  img: Float32Array,
  w: number,
  h: number
): IntegralImages {
  const stride = w + 1;
  const satSum = new Float64Array((w + 1) * (h + 1));
  const satSq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSq = 0;
    const imgRowOffset = y * w;
    const prevSatRowOffset = y * stride;
    const curSatRowOffset = (y + 1) * stride;

    for (let x = 0; x < w; x++) {
      const val = img[imgRowOffset + x];
      rowSum += val;
      rowSq += val * val;

      satSum[curSatRowOffset + x + 1] = satSum[prevSatRowOffset + x + 1] + rowSum;
      satSq[curSatRowOffset + x + 1] = satSq[prevSatRowOffset + x + 1] + rowSq;
    }
  }

  return { satSum, satSq, stride, w, h };
}

/**
 * Slide a single template over the image using zero-mean normalized cross-correlation.
 * Returns local maxima detections above minScore with greedy peak suppression.
 */
export function matchTemplate(
  image: GrayImage,
  template: GrayImage,
  minScore: number = 0.5,
  cachedIntegrals?: IntegralImages
): Detection[] {
  const { g: img, w: imgW, h: imgH } = image;
  const { g: tpl, w: tplW, h: tplH } = template;

  // Reject rather than guess. Non-integer dimensions index the backing
  // Float32Array at fractional offsets, whose writes are silently discarded —
  // the matcher then returns zero hits (or garbage) with no error at all. That
  // shipped once and disabled auto-count entirely; see .ai/06-bug-history.md.
  if (
    !Number.isInteger(imgW) ||
    !Number.isInteger(imgH) ||
    !Number.isInteger(tplW) ||
    !Number.isInteger(tplH)
  ) {
    throw new Error(
      `matchTemplate requires integer dimensions, received image ${imgW}x${imgH}, template ${tplW}x${tplH}`
    );
  }
  if (img.length < imgW * imgH || tpl.length < tplW * tplH) {
    throw new Error(
      `matchTemplate buffer smaller than its stated dimensions: image ${img.length} < ${imgW * imgH}, or template ${tpl.length} < ${tplW * tplH}`
    );
  }

  if (tplW > imgW || tplH > imgH || tplW <= 0 || tplH <= 0 || imgW <= 0 || imgH <= 0) {
    return [];
  }

  const N = tplW * tplH;

  // Step 1: Compute full template mean and variance
  let tplSum = 0;
  for (let i = 0; i < N; i++) tplSum += tpl[i];
  const tplMean = tplSum / N;

  const tplZeroMean = new Float32Array(N);
  let tplSumSq = 0;
  for (let i = 0; i < N; i++) {
    const zm = tpl[i] - tplMean;
    tplZeroMean[i] = zm;
    tplSumSq += zm * zm;
  }
  const tplNorm = Math.sqrt(tplSumSq);
  if (tplNorm < 1e-4) {
    return [];
  }

  // Step 2: Select feature points: dark linework points + background points for balanced contrast
  const darkPoints: { offset: number; val: number }[] = [];
  const lightPoints: { offset: number; val: number }[] = [];

  for (let v = 0; v < tplH; v++) {
    for (let u = 0; u < tplW; u++) {
      const idx = v * tplW + u;
      const zm = tplZeroMean[idx];
      const offset = v * imgW + u;
      if (zm < -10) {
        darkPoints.push({ offset, val: zm });
      } else if (zm > 5) {
        lightPoints.push({ offset, val: zm });
      }
    }
  }

  const MAX_POINTS = 384;
  let sampledPoints: { offset: number; rawVal: number }[] = [];

  if (darkPoints.length + lightPoints.length <= MAX_POINTS) {
    sampledPoints = darkPoints
      .map((p) => ({ offset: p.offset, rawVal: p.val + tplMean }))
      .concat(lightPoints.map((p) => ({ offset: p.offset, rawVal: p.val + tplMean })));
  } else {
    const half = Math.floor(MAX_POINTS / 2);
    const strideDark = Math.max(1, Math.floor(darkPoints.length / half));
    for (let i = 0; i < darkPoints.length && sampledPoints.length < half; i += strideDark) {
      sampledPoints.push({ offset: darkPoints[i].offset, rawVal: darkPoints[i].val + tplMean });
    }
    const strideLight = Math.max(1, Math.floor(lightPoints.length / half));
    for (let i = 0; i < lightPoints.length && sampledPoints.length < MAX_POINTS; i += strideLight) {
      sampledPoints.push({ offset: lightPoints[i].offset, rawVal: lightPoints[i].val + tplMean });
    }
  }

  // Zero-mean the sampled subset
  const M = sampledPoints.length;
  let subSum = 0;
  for (let i = 0; i < M; i++) subSum += sampledPoints[i].rawVal;
  const subMean = subSum / M;

  const flatOffsets = new Int32Array(M);
  const flatVals = new Float32Array(M);
  let subNormSq = 0;

  for (let i = 0; i < M; i++) {
    flatOffsets[i] = sampledPoints[i].offset;
    const zm = sampledPoints[i].rawVal - subMean;
    flatVals[i] = zm;
    subNormSq += zm * zm;
  }
  const subNorm = Math.sqrt(subNormSq);
  if (subNorm < 1e-4) {
    return [];
  }

  // Integral images for O(1) window checks
  const { satSum, satSq, stride } =
    cachedIntegrals && cachedIntegrals.w === imgW && cachedIntegrals.h === imgH
      ? cachedIntegrals
      : computeIntegralImages(img, imgW, imgH);

  const scoreW = imgW - tplW + 1;
  const scoreH = imgH - tplH + 1;
  const scores = new Float32Array(scoreW * scoreH);
  scores.fill(-1);

  // Fast evaluation function
  function evalScoreAt(x: number, y: number): number {
    const idx = y * scoreW + x;
    const cached = scores[idx];
    if (cached !== -1) return cached;

    // Check window variance via integral image
    const x0 = x;
    const x1 = x + tplW;
    const y0 = y;
    const y1 = y + tplH;
    const r0 = y0 * stride;
    const r1 = y1 * stride;

    const winSum = satSum[r1 + x1] - satSum[r0 + x1] - satSum[r1 + x0] + satSum[r0 + x0];
    const winSq = satSq[r1 + x1] - satSq[r0 + x1] - satSq[r1 + x0] + satSq[r0 + x0];
    const winMean = winSum / N;
    const winVar = winSq - N * winMean * winMean;

    if (winVar <= 1.0) {
      scores[idx] = -1;
      return -1;
    }

    const base = y * imgW + x;
    let dot = 0;
    let imgSubSum = 0;
    let imgSubSq = 0;

    for (let i = 0; i < M; i++) {
      const v = img[base + flatOffsets[i]];
      dot += v * flatVals[i];
      imgSubSum += v;
      imgSubSq += v * v;
    }

    const imgSubMean = imgSubSum / M;
    const imgSubVar = imgSubSq - M * imgSubMean * imgSubMean;

    if (imgSubVar <= 1.0) {
      scores[idx] = -1;
      return -1;
    }

    const s = dot / (Math.sqrt(imgSubVar) * subNorm);
    scores[idx] = s;
    return s;
  }

  // 2-step scanning:
  // Step 1: Scan grid at step 2 for candidates >= minScore - 0.25
  // Step 2: Refine candidate neighborhood at step 1
  const step = 2;
  const coarseCutoff = Math.max(0.3, minScore - 0.25);

  for (let y = 0; y < scoreH; y += step) {
    for (let x = 0; x < scoreW; x += step) {
      const s = evalScoreAt(x, y);
      if (s >= coarseCutoff) {
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= scoreH) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= scoreW) continue;
            evalScoreAt(nx, ny);
          }
        }
      }
    }
  }

  // Collect local maxima >= minScore
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y < scoreH; y++) {
    const rowOffset = y * scoreW;
    for (let x = 0; x < scoreW; x++) {
      const s = scores[rowOffset + x];
      if (s < minScore) continue;

      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= scoreH) continue;
        const nRow = ny * scoreW;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= scoreW) continue;
          const ns = scores[nRow + nx];
          if (ns > s || (ns === s && (ny < y || (ny === y && nx < x)))) {
            isMax = false;
            break;
          }
        }
      }

      if (isMax) {
        candidates.push({ x, y, score: Math.min(1.0, Math.max(-1.0, s)) });
      }
    }
  }

  // Greedy non-maximum suppression of peaks closer than half the template's smaller edge
  candidates.sort((a, b) => b.score - a.score);
  const minDist = 0.5 * Math.min(tplW, tplH);
  const kept: Detection[] = [];

  for (const c of candidates) {
    const cx = c.x + tplW / 2;
    const cy = c.y + tplH / 2;
    const suppressed = kept.some((k) => {
      const kx = k.x + k.w / 2;
      const ky = k.y + k.h / 2;
      return Math.hypot(kx - cx, ky - cy) < minDist;
    });

    if (!suppressed) {
      kept.push({
        x: c.x,
        y: c.y,
        w: tplW,
        h: tplH,
        confidence: c.score,
      });
    }
  }

  return kept;
}

/**
 * Match a template across all standard rotations (0, 90, 180, 270) and horizontal mirror.
 * Merges detections and performs greedy peak suppression.
 */
export function matchAll(
  image: GrayImage,
  template: GrayImage,
  minScore: number = 0.5
): Detection[] {
  const allVariants = rotations(template);
  const allDetections: Detection[] = [];
  const integrals = computeIntegralImages(image.g, image.w, image.h);

  for (const variant of allVariants) {
    const hits = matchTemplate(image, variant, minScore, integrals);
    allDetections.push(...hits);
  }

  // Sort by confidence descending
  allDetections.sort((a, b) => b.confidence - a.confidence);

  // Center-based non-maximum suppression
  const minDist = 0.5 * Math.min(template.w, template.h);
  const kept: Detection[] = [];

  for (const d of allDetections) {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const suppressed = kept.some((k) => {
      const kx = k.x + k.w / 2;
      const ky = k.y + k.h / 2;
      return Math.hypot(kx - cx, ky - cy) < minDist;
    });

    if (!suppressed) {
      kept.push(d);
    }
  }

  return kept;
}
