"use strict";
// Image decoding and the small amount of pixel math the face pipeline needs.
// An image is { data: Uint8Array (RGB, row-major), width, height }.
//
// resizeBilinear and warpAffine reimplement cv2.resize / cv2.warpAffine (INTER_LINEAR) on purpose:
// InsightFace's detector and aligner use them, and a different interpolation (sharp's default is
// Lanczos) would shift every embedding slightly and invalidate the calibrated threshold.

const sharp = require("sharp");

// libvips would otherwise size its thread pool from the host's reported cores, which on shared
// hosting is far more than the account's CPU quota. Decoding one photo gains nothing from threads.
sharp.concurrency(1);
sharp.cache(false);

/** Decode bytes to an RGB image, honoring EXIF orientation. Returns null if undecodable. */
async function decodeImage(buffer) {
  try {
    const { data, info } = await sharp(buffer, { failOn: "error" })
      .rotate() // applies the EXIF orientation, like PIL's ImageOps.exif_transpose
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width < 1 || info.height < 1) return null;
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** cv2.resize(img, (dstW, dstH)) with the default INTER_LINEAR (no anti-aliasing). */
function resizeBilinear(image, dstW, dstH) {
  const { data: src, width: sw, height: sh } = image;
  const out = new Uint8Array(dstW * dstH * 3);
  const scaleX = sw / dstW;
  const scaleY = sh / dstH;

  const xa = new Int32Array(dstW);
  const xb = new Int32Array(dstW);
  const xw = new Float32Array(dstW);
  for (let x = 0; x < dstW; x++) {
    let fx = (x + 0.5) * scaleX - 0.5;
    let sx = Math.floor(fx);
    fx -= sx;
    if (sx < 0) { sx = 0; fx = 0; }
    if (sx >= sw - 1) { sx = sw - 1; fx = 0; }
    xa[x] = sx * 3;
    xb[x] = Math.min(sx + 1, sw - 1) * 3;
    xw[x] = fx;
  }

  for (let y = 0; y < dstH; y++) {
    let fy = (y + 0.5) * scaleY - 0.5;
    let sy = Math.floor(fy);
    fy -= sy;
    if (sy < 0) { sy = 0; fy = 0; }
    if (sy >= sh - 1) { sy = sh - 1; fy = 0; }
    const row0 = sy * sw * 3;
    const row1 = Math.min(sy + 1, sh - 1) * sw * 3;
    let o = y * dstW * 3;
    for (let x = 0; x < dstW; x++) {
      const a = xa[x];
      const b = xb[x];
      const wx = xw[x];
      for (let c = 0; c < 3; c++) {
        const top = src[row0 + a + c] + (src[row0 + b + c] - src[row0 + a + c]) * wx;
        const bot = src[row1 + a + c] + (src[row1 + b + c] - src[row1 + a + c]) * wx;
        out[o++] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return { data: out, width: dstW, height: dstH };
}

/** cv2.copyMakeBorder(..., BORDER_CONSTANT, value=0): a black border of `border` px on every side. */
function padBorder(image, border) {
  const { data: src, width: sw, height: sh } = image;
  const dw = sw + 2 * border;
  const dh = sh + 2 * border;
  const out = new Uint8Array(dw * dh * 3); // zero-filled = black
  for (let y = 0; y < sh; y++) {
    out.set(src.subarray(y * sw * 3, (y + 1) * sw * 3), ((y + border) * dw + border) * 3);
  }
  return { data: out, width: dw, height: dh };
}

/**
 * cv2.warpAffine(img, M, (outW, outH), borderValue=0) with INTER_LINEAR.
 * M is the forward 2x3 matrix [[a, b, tx], [c, d, ty]] mapping source to destination coordinates.
 */
function warpAffine(image, M, outW, outH) {
  const { data: src, width: sw, height: sh } = image;
  const [[a, b, tx], [c, d, ty]] = M;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("singular affine transform");
  // Inverse mapping: for each destination pixel find where it comes from in the source.
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const itx = -(ia * tx + ib * ty);
  const ity = -(ic * tx + id * ty);

  const out = new Uint8Array(outW * outH * 3);
  const sample = (x, y, ch) => (x < 0 || y < 0 || x >= sw || y >= sh ? 0 : src[(y * sw + x) * 3 + ch]);
  let o = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const X = ia * x + ib * y + itx;
      const Y = ic * x + id * y + ity;
      const x0 = Math.floor(X);
      const y0 = Math.floor(Y);
      const fx = X - x0;
      const fy = Y - y0;
      for (let ch = 0; ch < 3; ch++) {
        const top = sample(x0, y0, ch) * (1 - fx) + sample(x0 + 1, y0, ch) * fx;
        const bot = sample(x0, y0 + 1, ch) * (1 - fx) + sample(x0 + 1, y0 + 1, ch) * fx;
        out[o++] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * Least-squares similarity transform (rotation + uniform scale + translation) taking `src` points
 * onto `dst`, as the 2x3 matrix skimage's SimilarityTransform.estimate produces.
 * With centred points the optimum has the closed form [[a, -b], [b, a]]; it equals the Umeyama
 * solution skimage uses whenever the fit is a proper rotation, which holds for face landmarks.
 */
function estimateSimilarity(src, dst) {
  const n = src.length;
  let smx = 0, smy = 0, dmx = 0, dmy = 0;
  for (let i = 0; i < n; i++) {
    smx += src[i][0]; smy += src[i][1];
    dmx += dst[i][0]; dmy += dst[i][1];
  }
  smx /= n; smy /= n; dmx /= n; dmy /= n;

  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - smx;
    const sy = src[i][1] - smy;
    const dx = dst[i][0] - dmx;
    const dy = dst[i][1] - dmy;
    num1 += sx * dx + sy * dy;
    num2 += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  if (den === 0) throw new Error("degenerate landmarks");
  const a = num1 / den;
  const b = num2 / den;
  return [
    [a, -b, dmx - (a * smx - b * smy)],
    [b, a, dmy - (b * smx + a * smy)],
  ];
}

module.exports = { decodeImage, resizeBilinear, padBorder, warpAffine, estimateSimilarity };
