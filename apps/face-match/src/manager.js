"use strict";
// Owns the face engine's life cycle inside the hub.
//
// The models cost ~600 MB of RAM and, on the very first run, a ~280 MB download, and the hub hosts
// other solutions in the same process. So by default nothing is loaded until someone opens Face
// Match (start() is idempotent and called from every route); set FACEMATCH_PRELOAD=1 to load at boot.
// While loading, `engine` is null and the router answers 503. A failed load is retried on a later
// request, at most every RETRY_MS, so a transient download error heals without restarting the hub.

const RETRY_MS = 30_000;

class EngineManager {
  /**
   * @param {object} opts
   * @param {object} opts.settings from loadSettings()
   * @param {(settings: object, log: Function) => Promise<object>} [opts.factory] builds the engine;
   *   tests pass a fake, production uses the default below.
   * @param {Function} [opts.log]
   */
  constructor({ settings, factory = defaultFactory, log = (m) => console.log(`[face-match] ${m}`) }) {
    this.settings = settings;
    this._factory = factory;
    this._log = log;
    this.engine = null;
    this.error = null;
    this._loading = false;
    this._failedAt = 0;
  }

  /** Begin loading if it hasn't started (or the last attempt failed long enough ago). Never throws. */
  start() {
    if (this.engine || this._loading) return;
    if (this.error && Date.now() - this._failedAt < RETRY_MS) return;
    this._loading = true;
    this.error = null;
    this._factory(this.settings, this._log)
      .then((engine) => {
        this.engine = engine;
        this._log("Ready");
      })
      .catch((err) => {
        this.error = String(err?.message ?? err);
        this._failedAt = Date.now();
        this._log(`Model load failed: ${this.error}`);
      })
      .finally(() => {
        this._loading = false;
      });
  }
}

async function defaultFactory(settings, log) {
  // Required lazily so the native onnxruntime/sharp bindings are only touched once Face Match is used.
  const { ensureModels } = require("./models");
  const { FaceEngine } = require("./engine");
  const modelDir = await ensureModels(settings.modelName, { log });
  log(`Loading models from ${modelDir} (${settings.intraOpThreads || "auto"} threads)`);
  return FaceEngine.create({
    modelDir,
    modelName: settings.modelName,
    detSize: settings.detSize,
    detThresh: settings.detThresh,
    intraOpThreads: settings.intraOpThreads,
  });
}

module.exports = { EngineManager, RETRY_MS };
