"use strict";
// Express router for Face Match: POST a reference image plus 1+ candidates, get a verdict per
// candidate. Mounted by the hub at /face-match behind the hub's login, so there is no auth here.
//
// Contract (same as the standalone Python/Node apps): /match always answers 200 with a status per
// image; 422 is only for malformed parameters; 503 while the models are still loading.

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");

const { decodeImage } = require("./imaging");
const { selectFace, matchReference } = require("./matching");
const { validateThreshold } = require("./config");

const STATIC_DIR = path.join(__dirname, "..", "static");
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 50;

class BadRequest extends Error {}

/** Parse "candidate:face" pairs, e.g. "0:1,2:0" -> Map {0 => 1, 2 => 0}. */
function parseCandidateFaces(raw, nCandidates) {
  const selection = new Map();
  if (!raw || !raw.trim()) return selection;
  for (const part of raw.split(",")) {
    const m = /^\s*(-?\d+)\s*:\s*(-?\d+)\s*$/.exec(part);
    if (!m) throw new BadRequest(`candidate_faces entry '${part}' is not 'candidate_index:face_index'`);
    const cand = Number(m[1]);
    if (cand < 0 || cand >= nCandidates) {
      throw new BadRequest(`candidate_faces refers to candidate ${cand}, but only ${nCandidates} were sent`);
    }
    selection.set(cand, Number(m[2]));
  }
  return selection;
}

function parseOptionalInt(raw, name) {
  if (raw === undefined || String(raw).trim() === "") return null;
  if (!/^\s*-?\d+\s*$/.test(String(raw))) throw new BadRequest(`${name} must be an integer`);
  return Number(raw);
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

function faceJson(face, index) {
  return { index, bbox: face.bbox.map((v) => round(v, 1)), det_score: round(face.detScore, 4) };
}

function imageJson(img) {
  return {
    filename: img.filename,
    status: img.status,
    faces: img.faces.map(faceJson),
    selected_face: img.selectedFace,
  };
}

function reportJson(report) {
  return {
    status: report.complete ? "ok" : "incomplete",
    threshold: report.threshold,
    reference: imageJson(report.reference),
    results: report.candidates.map((c) => ({
      candidate_index: c.index,
      ...imageJson(c.image),
      score: c.score === null ? null : round(c.score, 4),
      match: c.match,
    })),
  };
}

// Express 4 doesn't catch rejected promises from async handlers.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {object} opts
 * @param {{engine: object|null, error: string|null, start: () => void}} opts.manager
 * @param {object} opts.settings from loadSettings()
 * @param {(entry: object) => void} [opts.requestLog] receives one metadata-only entry per /match
 */
function createRouter({ manager, settings, requestLog = () => {} }) {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 20, parts: MAX_FILES + 20 },
  });

  router.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  router.get("/", (req, res) => {
    manager.start(); // opening the page is the cue to warm the models up
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(STATIC_DIR, "index.html"));
  });

  router.use("/static", express.static(STATIC_DIR, { index: false, maxAge: "7d" }));

  router.get("/health", (req, res) => {
    manager.start();
    res.set("Cache-Control", "no-store");
    res.json({
      status: "ok",
      ready: manager.engine !== null,
      model: manager.engine ? manager.engine.modelName : null,
      threshold: settings.threshold,
      threshold_source: settings.thresholdSource,
      ...(manager.error ? { load_error: manager.error } : {}),
    });
  });

  router.post(
    "/match",
    (req, res, next) => {
      if (!req.is("multipart/form-data")) {
        return next(new BadRequest("Send multipart/form-data with 'reference' and 'candidates' files"));
      }
      upload.any()(req, res, next);
    },
    wrap(async (req, res) => {
      const started = performance.now();
      res.set("Cache-Control", "no-store");

      const files = req.files || [];
      const refs = files.filter((f) => f.fieldname === "reference");
      const candidates = files.filter((f) => f.fieldname === "candidates" || f.fieldname === "candidates[]");
      if (refs.length === 0) throw new BadRequest("Missing 'reference' file");
      if (refs.length > 1) throw new BadRequest("Send exactly one 'reference' file");
      if (candidates.length === 0) throw new BadRequest("Missing 'candidates' file(s)");

      const fields = req.body || {};
      const threshold =
        fields.threshold === undefined || String(fields.threshold).trim() === "" ? settings.threshold : Number(fields.threshold);
      try {
        validateThreshold(threshold);
      } catch (err) {
        throw new BadRequest(err.message);
      }
      const referenceFace = parseOptionalInt(fields.reference_face, "reference_face");
      const picks = parseCandidateFaces(fields.candidate_faces, candidates.length);

      manager.start();
      const engine = manager.engine;
      if (!engine) {
        res.set("Retry-After", "10");
        return res.status(503).json({
          detail: manager.error
            ? `The face model failed to load: ${manager.error}`
            : "The face model is still loading. Try again in a minute.",
        });
      }

      async function analyze(upload, faceIndex) {
        const image = await decodeImage(upload.buffer);
        const faces = image === null ? null : await engine.detect(image);
        return selectFace(upload.originalname || "", faces, faceIndex);
      }

      const ref = await analyze(refs[0], referenceFace);
      const analyzed = [];
      for (let i = 0; i < candidates.length; i++) analyzed.push(await analyze(candidates[i], picks.get(i) ?? null));

      const body = reportJson(matchReference(ref, analyzed, threshold));
      // Metadata only (FR5): no pixels and no embeddings ever reach the log.
      requestLog({
        request_id: crypto.randomUUID().replaceAll("-", ""),
        timestamp: new Date().toISOString(),
        elapsed_ms: round(performance.now() - started, 1),
        ...body,
      });
      res.json(body);
    }),
  );

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof BadRequest) return res.status(422).json({ detail: err.message });
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      return res.status(413).json({
        detail: tooBig ? `A photo is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` : `Too many files or fields (${err.code}).`,
      });
    }
    console.error("[face-match]", err);
    res.status(500).json({ detail: "Internal server error" });
  });

  return router;
}

module.exports = { createRouter, parseCandidateFaces, reportJson };
