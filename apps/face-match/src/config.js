"use strict";
// Runtime settings: config/facematch.json with env overrides (set them in the hub's .env).
//
// FACEMATCH_CONFIG      path to an alternative config file
// FACEMATCH_THRESHOLD   overrides the match threshold
// FACEMATCH_THREADS     overrides intra_op_threads
// FACEMATCH_MODEL_DIR   where the model files live (see models.js)
// FACEMATCH_PRELOAD     "1" loads the models when the hub starts instead of on first use

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(APP_ROOT, "config", "facematch.json");

function validateThreshold(threshold) {
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`threshold must be in [0, 1], got ${threshold}`);
}

function loadSettings(env = process.env) {
  const configPath = env.FACEMATCH_CONFIG || DEFAULT_CONFIG_PATH;
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  let threshold = raw.threshold;
  let thresholdSource = raw.threshold_source;
  if (env.FACEMATCH_THRESHOLD !== undefined && env.FACEMATCH_THRESHOLD !== "") {
    threshold = Number(env.FACEMATCH_THRESHOLD);
    thresholdSource = "FACEMATCH_THRESHOLD env var";
  }
  validateThreshold(threshold);

  const logPath = raw.log_path ?? "logs/facematch.log";
  const threads = env.FACEMATCH_THREADS ? Number(env.FACEMATCH_THREADS) : raw.intra_op_threads ?? 0;
  if (!Number.isInteger(threads) || threads < 0) throw new Error(`intra_op_threads must be an integer >= 0, got ${threads}`);

  return {
    threshold,
    thresholdSource,
    modelName: raw.model_name ?? "buffalo_l",
    detSize: raw.det_size ?? 640,
    detThresh: raw.det_thresh ?? 0.5,
    intraOpThreads: threads,
    logPath: path.isAbsolute(logPath) ? logPath : path.join(APP_ROOT, logPath),
  };
}

module.exports = { loadSettings, validateThreshold, APP_ROOT };
