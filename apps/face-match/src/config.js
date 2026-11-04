"use strict";
// Runtime settings: config/facematch.json with env overrides (set them in the hub's .env).
//
// FACEMATCH_CONFIG              path to an alternative config file
// FACEMATCH_MATCH_THRESHOLD     overrides the match line (scores at or above are "same person")
// FACEMATCH_POSSIBLE_THRESHOLD  overrides where "possibly the same person" starts
// FACEMATCH_THREADS             overrides intra_op_threads
// FACEMATCH_MODEL_DIR           where the model files live (see models.js)
// FACEMATCH_PRELOAD             "1" loads the models when the hub starts instead of on first use

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(APP_ROOT, "config", "facematch.json");

function validateThreshold(threshold, name = "threshold") {
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`${name} must be in [0, 1], got ${threshold}`);
}

const isSet = (v) => v !== undefined && v !== "";

function loadSettings(env = process.env) {
  const configPath = env.FACEMATCH_CONFIG || DEFAULT_CONFIG_PATH;
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));

  let matchThreshold = raw.match_threshold;
  let matchThresholdSource = raw.match_threshold_source;
  if (isSet(env.FACEMATCH_MATCH_THRESHOLD)) {
    matchThreshold = Number(env.FACEMATCH_MATCH_THRESHOLD);
    matchThresholdSource = "FACEMATCH_MATCH_THRESHOLD env var";
  }
  let possibleThreshold = raw.possible_threshold;
  let possibleThresholdSource = raw.possible_threshold_source;
  if (isSet(env.FACEMATCH_POSSIBLE_THRESHOLD)) {
    possibleThreshold = Number(env.FACEMATCH_POSSIBLE_THRESHOLD);
    possibleThresholdSource = "FACEMATCH_POSSIBLE_THRESHOLD env var";
  }
  validateThreshold(matchThreshold, "match_threshold");
  validateThreshold(possibleThreshold, "possible_threshold");
  if (possibleThreshold > matchThreshold) {
    throw new Error(`possible_threshold (${possibleThreshold}) cannot be above match_threshold (${matchThreshold})`);
  }

  const logPath = raw.log_path ?? "logs/facematch.log";
  const threads = env.FACEMATCH_THREADS ? Number(env.FACEMATCH_THREADS) : raw.intra_op_threads ?? 0;
  if (!Number.isInteger(threads) || threads < 0) throw new Error(`intra_op_threads must be an integer >= 0, got ${threads}`);

  return {
    matchThreshold,
    matchThresholdSource,
    possibleThreshold,
    possibleThresholdSource,
    modelName: raw.model_name ?? "buffalo_l",
    detSize: raw.det_size ?? 640,
    detThresh: raw.det_thresh ?? 0.5,
    intraOpThreads: threads,
    logPath: path.isAbsolute(logPath) ? logPath : path.join(APP_ROOT, logPath),
  };
}

module.exports = { loadSettings, validateThreshold, APP_ROOT };
