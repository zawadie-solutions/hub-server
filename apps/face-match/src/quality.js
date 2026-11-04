"use strict";
// Photo-quality warnings for one detected face. They explain why a result may be less certain; they
// never change the verdict, and they are not a promise that a photo without warnings is reliable.
//
// The thresholds were chosen from measurements (November 2026), not guessed. On 80 same-person
// pairs (CFP) with the second photo degraded (blur, shrink-and-enlarge, heavy JPEG, all three), the
// rules below flagged a photo whose confident match then got lost about nine times in ten, with no
// false alarms on the undegraded CFP photos. They catch only about a quarter of the lost matches,
// though: most losses show no simple image signal, and the "possibly the same person" band is what
// catches those. Rejected after measuring: low detection confidence (weak predictor, flags 16% of old
// scans) and the model's feature norm (rises, rather than falls, when photos degrade).

const SMALL_FACE_PX = 80; // shorter side of the face box; the model sees a 112 px crop, so smaller is enlarged
const BLURRY_SHARPNESS = 100; // variance of the Laplacian on the 112x112 aligned crop (good photos: 500+)
const TURNED_HEAD = 1.0; // nose offset from the eye midpoint, in eye distances (frontal ~0.05, profile 1+)

/** Variance of the Laplacian of the crop's grayscale: low means few sharp edges. */
function sharpness(crop) {
  const { data, width: w, height: h } = crop;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + x - 1] + gray[y * w + x + 1] - 4 * gray[y * w + x];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * @param {object} face
 * @param {number[]} face.box [x1, y1, x2, y2] before clamping to the image
 * @param {number[][]} face.kps five landmarks: left eye, right eye, nose, left mouth, right mouth
 * @param {{data: Uint8Array, width: number, height: number}} face.crop the aligned 112x112 RGB crop
 * @returns {{level: "good"|"fair"|"poor", issues: string[], face_px: number, sharpness: number, head_turn: number}}
 */
function assessQuality({ box, kps, crop }) {
  const facePx = Math.min(box[2] - box[0], box[3] - box[1]);
  const sharp = sharpness(crop);
  const [leftEye, rightEye, nose] = kps;
  const eyeDist = Math.hypot(rightEye[0] - leftEye[0], rightEye[1] - leftEye[1]);
  const headTurn = eyeDist > 0 ? Math.abs(nose[0] - (leftEye[0] + rightEye[0]) / 2) / eyeDist : 0;

  const issues = [];
  if (facePx < SMALL_FACE_PX) issues.push("small_face");
  if (sharp < BLURRY_SHARPNESS) issues.push("blurry");
  if (headTurn >= TURNED_HEAD) issues.push("turned_head");

  return {
    level: issues.length === 0 ? "good" : issues.length === 1 ? "fair" : "poor",
    issues,
    face_px: Math.round(facePx),
    sharpness: Math.round(sharp),
    head_turn: Math.round(headTurn * 100) / 100,
  };
}

module.exports = { assessQuality, sharpness, SMALL_FACE_PX, BLURRY_SHARPNESS, TURNED_HEAD };
