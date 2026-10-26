"use strict";
// One JSON line per request in a size-rotated file. Metadata only (FR5): the entries passed in
// must never contain pixels or embeddings, and nothing here adds any.

const fs = require("fs");
const path = require("path");

const MAX_BYTES = 5_000_000;
const BACKUPS = 3;

function rotate(file) {
  for (let i = BACKUPS; i >= 1; i--) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    try {
      fs.renameSync(from, `${file}.${i}`);
    } catch {
      /* nothing to rotate at this level */
    }
  }
}

function createFileRequestLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return function write(entry) {
    try {
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        /* first write */
      }
      if (size > MAX_BYTES) rotate(file);
      fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
    } catch (err) {
      // A full disk or bad permissions must not turn a successful match into a failed request.
      console.error(`Could not write request log: ${err.message}`);
    }
  };
}

module.exports = { createFileRequestLog };
