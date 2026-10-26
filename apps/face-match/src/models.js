"use strict";
// Locate the two InsightFace model files, downloading them on first use.
//
// Search order: FACEMATCH_MODEL_DIR, then ~/.insightface/models/<name> (where the Python app keeps
// them, so a machine that already ran it needs no download), then ./models. The download goes to the
// first of those that is writable. The home directory is preferred over the app folder because
// hosting platforms replace the app folder on every deploy but keep the home directory.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { DET_FILE, REC_FILE } = require("./engine");

const ZIP_URL = "https://github.com/deepinsight/insightface/releases/download/model-zoo/";
const WANTED = [DET_FILE, REC_FILE];
// Sanity floor on file sizes, to catch truncated or error-page downloads.
const MIN_BYTES = { [DET_FILE]: 10_000_000, [REC_FILE]: 100_000_000 };

function candidateDirs(modelName, env = process.env) {
  const dirs = [];
  if (env.FACEMATCH_MODEL_DIR) dirs.push(env.FACEMATCH_MODEL_DIR);
  dirs.push(path.join(os.homedir(), ".insightface", "models", modelName));
  dirs.push(path.join(__dirname, "..", "models"));
  return dirs;
}

function hasModels(dir) {
  return WANTED.every((f) => {
    try {
      return fs.statSync(path.join(dir, f)).size >= MIN_BYTES[f];
    } catch {
      return false;
    }
  });
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Return a folder containing both model files, downloading them first if no candidate has them. */
async function ensureModels(modelName, { log = () => {}, env = process.env } = {}) {
  const dirs = candidateDirs(modelName, env);
  const existing = dirs.find(hasModels);
  if (existing) return existing;

  const target = dirs.find(isWritable);
  if (!target) throw new Error(`No writable model folder. Tried: ${dirs.join(", ")}`);
  await download(modelName, target, log);
  return target;
}

async function download(modelName, dir, log) {
  const url = `${ZIP_URL}${modelName}.zip`;
  const zipPath = path.join(dir, `${modelName}.zip.part`);
  log(`Downloading ${url} to ${dir}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status} from ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  let nextReport = 25;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (total && (received / total) * 100 >= nextReport) {
        log(`Downloaded ${nextReport}%`);
        nextReport += 25;
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(zipPath));
    log("Extracting models");
    await extract(zipPath, dir);
  } finally {
    fs.rmSync(zipPath, { force: true });
  }
  if (!hasModels(dir)) throw new Error("Model download finished but the files look incomplete");
  log("Models ready");
}

function extract(zipPath, dir) {
  const yauzl = require("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        const name = path.basename(entry.fileName);
        if (!WANTED.includes(name)) return zip.readEntry();
        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          // Write under a temp name and rename, so a half-written model is never mistaken for a real one.
          const tmp = path.join(dir, `${name}.part`);
          pipeline(stream, fs.createWriteStream(tmp))
            .then(() => {
              fs.renameSync(tmp, path.join(dir, name));
              zip.readEntry();
            })
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}

module.exports = { ensureModels, candidateDirs, hasModels };
