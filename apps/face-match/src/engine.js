"use strict";
// Face engine: SCRFD detection + 5-point alignment + ArcFace R50 embeddings on onnxruntime (CPU).
// Port of facematch/engine.py and the parts of InsightFace it relies on (scrfd.py, face_align.py,
// arcface_onnx.py). Faces are returned largest first, and that order defines the face indices
// callers use.

const path = require("path");
const ort = require("onnxruntime-node");
const { resizeBilinear, padBorder, warpAffine, estimateSimilarity } = require("./imaging");

const DET_FILE = "det_10g.onnx";
const REC_FILE = "w600k_r50.onnx";

// Fraction of the longer side added as black border when retrying detection.
// RetinaFace misses faces that fill the whole frame (tight crops, scanned portraits).
const PAD_RATIO = 0.5;

const NMS_THRESH = 0.4;
const STRIDES = [8, 16, 32];
const NUM_ANCHORS = 2;
const DET_MEAN = 127.5;
const DET_STD = 128.0;
const REC_SIZE = 112;
const REC_MEAN = 127.5;
const REC_STD = 127.5;

// ArcFace reference landmarks in a 112x112 crop (insightface.utils.face_align.arcface_dst).
const ARCFACE_DST = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** Greedy non-max suppression over rows sorted by score, descending. Returns kept row indices. */
function nms(boxes, scores, thresh) {
  const n = scores.length;
  const areas = boxes.map((b) => (b[2] - b[0] + 1) * (b[3] - b[1] + 1));
  const suppressed = new Uint8Array(n);
  const keep = [];
  for (let i = 0; i < n; i++) {
    if (suppressed[i]) continue;
    keep.push(i);
    for (let j = i + 1; j < n; j++) {
      if (suppressed[j]) continue;
      const w = Math.max(0, Math.min(boxes[i][2], boxes[j][2]) - Math.max(boxes[i][0], boxes[j][0]) + 1);
      const h = Math.max(0, Math.min(boxes[i][3], boxes[j][3]) - Math.max(boxes[i][1], boxes[j][1]) + 1);
      const inter = w * h;
      if (inter / (areas[i] + areas[j] - inter) > thresh) suppressed[j] = 1;
    }
  }
  return keep;
}

class FaceEngine {
  /**
   * @param {object} opts
   * @param {string} opts.modelDir folder holding det_10g.onnx and w600k_r50.onnx
   * @param {string} [opts.modelName]
   * @param {number} [opts.detSize] square detector input size
   * @param {number} [opts.detThresh] minimum detection score
   * @param {number} [opts.intraOpThreads] CPU threads per model run; 0 lets onnxruntime decide.
   *   On shared hosting the host reports every core on the machine but the account gets a small
   *   quota, and the default oversubscribes it (measured 7x slower on Hostinger).
   */
  static async create({ modelDir, modelName = "buffalo_l", detSize = 640, detThresh = 0.5, intraOpThreads = 0 }) {
    const options = {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      executionMode: "sequential",
      interOpNumThreads: 1,
      logSeverityLevel: 3,
      ...(intraOpThreads > 0 ? { intraOpNumThreads: intraOpThreads } : {}),
    };
    const det = await ort.InferenceSession.create(path.join(modelDir, DET_FILE), options);
    const rec = await ort.InferenceSession.create(path.join(modelDir, REC_FILE), options);
    return new FaceEngine({ det, rec, modelName, detSize, detThresh });
  }

  constructor({ det, rec, modelName, detSize, detThresh }) {
    this.modelName = modelName;
    this._det = det;
    this._rec = rec;
    this._detSize = detSize;
    this._detThresh = detThresh;
    this._queue = Promise.resolve();
    this._centers = new Map();
  }

  /**
   * Detect, align and embed every face, largest first.
   * pad = null/undefined tries the raw image and retries with a border if nothing is found;
   * pad = true goes straight to the padded image (for datasets of tight crops);
   * pad = false never pads.
   * Calls are serialized: the CPU quota is small and the model already uses every thread it gets.
   * @returns {Promise<import("./matching").DetectedFace[]>}
   */
  detect(image, pad = null) {
    const run = this._queue.then(() => this._detect(image, pad));
    this._queue = run.catch(() => {});
    return run;
  }

  async _detect(image, pad) {
    let faces = [];
    let offset = 0;
    let used = image;
    if (!pad) faces = await this._detectAndEmbed(image);
    if (faces.length === 0 && pad !== false) {
      offset = Math.trunc((Math.max(image.height, image.width) * PAD_RATIO) / 2);
      used = padBorder(image, offset);
      faces = await this._detectAndEmbed(used);
    }

    const { width: w, height: h } = image;
    const detected = faces.map((f) => {
      const [x1, y1, x2, y2] = f.box.map((v) => v - offset);
      return {
        bbox: [Math.max(x1, 0), Math.max(y1, 0), Math.min(x2, w), Math.min(y2, h)],
        detScore: f.score,
        embedding: f.embedding,
      };
    });
    const area = (d) => (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1]);
    detected.sort((a, b) => area(b) - area(a)); // stable, like Python's sort
    return detected;
  }

  async _detectAndEmbed(image) {
    const found = await this._detectRaw(image);
    const out = [];
    for (const f of found) out.push({ ...f, embedding: await this._embed(image, f.kps) });
    return out;
  }

  /** SCRFD: letterbox to detSize, run, decode anchors, NMS. Boxes and landmarks are in `image` pixels. */
  async _detectRaw(image) {
    const size = this._detSize;
    const imRatio = image.height / image.width;
    let newW;
    let newH;
    if (imRatio > 1) {
      newH = size;
      newW = Math.trunc(newH / imRatio);
    } else {
      newW = size;
      newH = Math.trunc(newW * imRatio);
    }
    if (newW < 1 || newH < 1) return []; // degenerate aspect ratio: nothing to detect
    const detScale = newH / image.height;
    const resized = resizeBilinear(image, newW, newH);

    // NCHW float blob, (px - 127.5) / 128. The unfilled letterbox area is black, i.e. (0 - 127.5) / 128.
    const plane = size * size;
    const blob = new Float32Array(3 * plane).fill((0 - DET_MEAN) / DET_STD);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const s = (y * newW + x) * 3;
        const d = y * size + x;
        blob[d] = (resized.data[s] - DET_MEAN) / DET_STD;
        blob[plane + d] = (resized.data[s + 1] - DET_MEAN) / DET_STD;
        blob[2 * plane + d] = (resized.data[s + 2] - DET_MEAN) / DET_STD;
      }
    }

    const session = this._det;
    const outs = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", blob, [1, 3, size, size]) });
    const o = session.outputNames.map((name) => outs[name].data);

    const rows = [];
    STRIDES.forEach((stride, idx) => {
      const scores = o[idx];
      const bboxPreds = o[idx + STRIDES.length];
      const kpsPreds = o[idx + STRIDES.length * 2];
      const cells = size / stride;
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] < this._detThresh) continue;
        const cell = Math.floor(i / NUM_ANCHORS); // each cell centre is repeated once per anchor
        const cx = (cell % cells) * stride;
        const cy = Math.floor(cell / cells) * stride;
        const box = [
          (cx - bboxPreds[i * 4] * stride) / detScale,
          (cy - bboxPreds[i * 4 + 1] * stride) / detScale,
          (cx + bboxPreds[i * 4 + 2] * stride) / detScale,
          (cy + bboxPreds[i * 4 + 3] * stride) / detScale,
        ];
        const kps = [];
        for (let k = 0; k < 5; k++) {
          kps.push([
            (cx + kpsPreds[i * 10 + 2 * k] * stride) / detScale,
            (cy + kpsPreds[i * 10 + 2 * k + 1] * stride) / detScale,
          ]);
        }
        rows.push({ box, score: scores[i], kps });
      }
    });

    rows.sort((a, b) => b.score - a.score); // stable
    const keep = nms(rows.map((r) => r.box), rows.map((r) => r.score), NMS_THRESH);
    return keep.map((i) => rows[i]);
  }

  /** Align the face to the 112x112 ArcFace template and return its L2-normalized embedding. */
  async _embed(image, kps) {
    const M = estimateSimilarity(kps, ARCFACE_DST);
    const crop = warpAffine(image, M, REC_SIZE, REC_SIZE);

    const plane = REC_SIZE * REC_SIZE;
    const blob = new Float32Array(3 * plane);
    for (let p = 0; p < plane; p++) {
      blob[p] = (crop.data[p * 3] - REC_MEAN) / REC_STD;
      blob[plane + p] = (crop.data[p * 3 + 1] - REC_MEAN) / REC_STD;
      blob[2 * plane + p] = (crop.data[p * 3 + 2] - REC_MEAN) / REC_STD;
    }
    const session = this._rec;
    const outs = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", blob, [1, 3, REC_SIZE, REC_SIZE]) });
    const raw = outs[session.outputNames[0]].data;

    let norm = 0;
    for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
    norm = Math.sqrt(norm);
    const emb = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) emb[i] = raw[i] / norm;
    return emb;
  }

  async close() {
    await Promise.all([this._det.release(), this._rec.release()]);
  }
}

module.exports = { FaceEngine, nms, PAD_RATIO, DET_FILE, REC_FILE };
