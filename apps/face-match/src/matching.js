"use strict";
// Model-free matching logic: face selection per image and reference-vs-candidate scoring.
// Port of facematch/matching.py; keep the two in step.

const ImageStatus = Object.freeze({
  OK: "ok",
  INVALID_IMAGE: "invalid_image",
  NO_FACE: "no_face",
  MULTIPLE_FACES: "multiple_faces", // caller must pick a face index and re-submit
  INVALID_FACE_INDEX: "invalid_face_index",
});

/**
 * @typedef {{bbox: number[], detScore: number, embedding: Float32Array}} DetectedFace
 *   bbox is [x1, y1, x2, y2] in original image pixels; embedding is L2-normalized.
 */

class ImageAnalysis {
  constructor(filename, status, faces, selectedFace = null) {
    this.filename = filename;
    this.status = status;
    this.faces = faces;
    this.selectedFace = selectedFace;
  }

  get embedding() {
    return this.status === ImageStatus.OK ? this.faces[this.selectedFace].embedding : null;
  }
}

/** Resolve which face in an image to use. Never guesses when there are several faces (FR2). */
function selectFace(filename, faces, faceIndex) {
  if (faces === null || faces === undefined) return new ImageAnalysis(filename, ImageStatus.INVALID_IMAGE, []);
  if (faces.length === 0) return new ImageAnalysis(filename, ImageStatus.NO_FACE, []);
  if (faceIndex !== null && faceIndex !== undefined) {
    if (Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < faces.length) {
      return new ImageAnalysis(filename, ImageStatus.OK, faces, faceIndex);
    }
    return new ImageAnalysis(filename, ImageStatus.INVALID_FACE_INDEX, faces);
  }
  if (faces.length === 1) return new ImageAnalysis(filename, ImageStatus.OK, faces, 0);
  return new ImageAnalysis(filename, ImageStatus.MULTIPLE_FACES, faces);
}

/** Cosine similarity clamped to [0, 1]; negative similarity means "clearly different". */
function cosineScore(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.min(Math.max(sim, 0), 1);
}

/** Score each candidate against the reference. A pair matches when score >= threshold. */
function matchReference(reference, candidates, threshold) {
  const refEmb = reference.embedding;
  const results = candidates.map((image, index) => {
    const candEmb = image.embedding;
    if (refEmb === null || candEmb === null) return { index, image, score: null, match: null };
    const score = cosineScore(refEmb, candEmb);
    return { index, image, score, match: score >= threshold };
  });
  const complete = reference.status === ImageStatus.OK && candidates.every((c) => c.status === ImageStatus.OK);
  return { reference, candidates: results, threshold, complete };
}

module.exports = { ImageStatus, ImageAnalysis, selectFace, cosineScore, matchReference };
