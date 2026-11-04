// Router tests with a fake detector: an image's colour encodes its faces.
//   red channel   -> identity of face 0 (face k has identity red + k)
//   green channel -> how far the face is rotated away from its identity's axis (angle = green / 100 rad),
//                    so two photos of the same identity score cos(angle difference): green 0 vs 0 -> 1.0
//   blue channel  -> number of faces (blue // 50)
// The router is mounted at /face-match on a real Express server, like the hub does.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import sharp from 'sharp';
import routerMod from '../src/router.js';
import managerMod from '../src/manager.js';

const { createRouter, parseCandidateFaces } = routerMod;
const { EngineManager, RETRY_MS } = managerMod;

const fakeEngine = {
  modelName: 'fake',
  async detect(image) {
    const r = image.data[0];
    const angle = image.data[1] / 100;
    const b = image.data[2];
    const faces = [];
    for (let k = 0; k < Math.floor(b / 50); k++) {
      const embedding = new Float32Array(16);
      embedding[(r + k) % 16] = Math.cos(angle);
      embedding[(r + k + 8) % 16] = Math.sin(angle);
      // A 9 px wide image stands in for a poor-quality photo; the real engine measures this from the pixels.
      const quality = image.width === 9
        ? { level: 'fair', issues: ['blurry'], face_px: 200, sharpness: 40, head_turn: 0 }
        : { level: 'good', issues: [], face_px: 200, sharpness: 900, head_turn: 0 };
      faces.push({ bbox: [0, 0, 10 - k, 10 - k], detScore: 0.99, embedding, quality });
    }
    return faces;
  },
};

const settings = {
  matchThreshold: 0.5,
  matchThresholdSource: 'test match',
  possibleThreshold: 0.3,
  possibleThresholdSource: 'test possible',
};
const png = (identity, nFaces = 1, angle = 0, width = 8) =>
  sharp({ create: { width, height: 8, channels: 3, background: { r: identity, g: angle, b: nFaces * 50 } } }).png().toBuffer();
// A same-identity photo scores cos(angle / 100) against an angle-0 photo: 121 -> 0.353, 80 -> 0.697.

const manager = { engine: fakeEngine, error: null, started: 0, start() { this.started += 1; } };
const logged = [];
let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use('/face-match', createRouter({ manager, settings, requestLog: (e) => logged.push(e) }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/face-match`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

function form(parts, fields = {}) {
  const fd = new FormData();
  for (const [name, buf, filename] of parts) fd.append(name, new Blob([buf], { type: 'image/png' }), filename);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
}

async function match(reference, candidates, fields = {}) {
  const parts = [['reference', reference, 'ref.png'], ...candidates.map((c, i) => ['candidates', c, `c${i}.png`])];
  const res = await fetch(`${base}/match`, { method: 'POST', body: form(parts, fields) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe('POST /match', () => {
  it('scores a reference against candidates', async () => {
    const { status, body } = await match(await png(3), [await png(3), await png(7)]);
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.threshold).toBe(0.5);
    expect(body.possible_threshold).toBe(0.3);
    expect(body.results.map((c) => [c.candidate_index, c.match, c.score])).toEqual([[0, true, 1], [1, false, 0]]);
    expect(body.results.map((c) => c.verdict)).toEqual(['match', 'no_match']);
  });

  it('sorts scores into three outcomes: match, possible, no match', async () => {
    // Scores against the angle-0 reference: 1.0, ~0.70, ~0.35, 0.
    const { body } = await match(await png(3), [await png(3), await png(3, 1, 80), await png(3, 1, 121), await png(7)]);
    expect(body.results.map((c) => c.verdict)).toEqual(['match', 'match', 'possible', 'no_match']);
    expect(body.results[1].score).toBeCloseTo(Math.cos(0.8), 3);
    expect(body.results[2].score).toBeCloseTo(Math.cos(1.21), 3);
    // `match` is true only for a confident match, never for "possible".
    expect(body.results.map((c) => c.match)).toEqual([true, true, false, false]);
  });

  it('puts the boundaries on the inclusive side', async () => {
    // Score exactly 0.5 / 0.3 would need float luck; check the rule with thresholds equal to the scores instead.
    const cand = await png(3, 1, 121);
    const score = (await match(await png(3), [cand])).body.results[0].score;
    expect((await match(await png(3), [cand], { threshold: score })).body.results[0].verdict).toBe('match');
  });

  it('lets the threshold override move the match line, and keeps the possible band consistent', async () => {
    const cand = await png(3, 1, 121); // score ~0.35
    const strict = (await match(await png(3), [cand], { threshold: 0.9 })).body;
    expect(strict.threshold).toBe(0.9);
    expect(strict.possible_threshold).toBe(0.3);
    expect(strict.results[0].verdict).toBe('possible');
    const lenient = (await match(await png(3), [cand], { threshold: 0.2 })).body;
    expect(lenient.results[0].verdict).toBe('match');
    // A match line below the possible line leaves no possible band: it can never sit above the match line.
    expect(lenient.possible_threshold).toBe(0.2);
  });

  it('reports photo quality for each face, and quality never changes the verdict', async () => {
    const { body } = await match(await png(3), [await png(3), await png(3, 1, 0, 9)]);
    const q = (face) => face.faces[face.selected_face].quality;
    expect(q(body.reference)).toMatchObject({ level: 'good', issues: [] });
    expect(q(body.results[0])).toMatchObject({ level: 'good', issues: [] });
    expect(q(body.results[1])).toMatchObject({ level: 'fair', issues: ['blurry'], sharpness: 40 });
    // The blurry candidate still scores 1.0 and is still a match: warnings explain, they don't decide.
    expect(body.results[1].verdict).toBe('match');
  });

  it('accepts a threshold override', async () => {
    const { body } = await match(await png(3), [await png(7)], { threshold: 0 });
    expect(body.threshold).toBe(0);
    expect(body.results[0].match).toBe(true);
  });

  it.each([1.5, -0.1, 'abc'])('rejects threshold %s with a readable message', async (bad) => {
    const { status, body } = await match(await png(3), [await png(3)], { threshold: bad });
    expect(status).toBe(422);
    expect(typeof body.detail).toBe('string'); // the upload page shows this text
  });

  it('lists the faces and scores nothing for a multi-face reference', async () => {
    const { body } = await match(await png(3, 2), [await png(3)]);
    expect(body.status).toBe('incomplete');
    expect(body.reference.status).toBe('multiple_faces');
    expect(body.reference.faces.map((f) => f.index)).toEqual([0, 1]);
    expect(body.results[0].match).toBeNull();
  });

  it('resubmits with a face selection', async () => {
    // Reference face 1 has identity 4; candidate 0's second face (index 1) also has identity 4.
    const { body } = await match(await png(3, 2), [await png(3, 2)], { reference_face: 1, candidate_faces: '0:1' });
    expect(body.status).toBe('ok');
    expect(body.results[0].match).toBe(true);
    expect(body.reference.selected_face).toBe(1);
  });

  it('reports no-face and invalid images per candidate', async () => {
    const fd = form([
      ['reference', await png(3), 'ref.png'],
      ['candidates', await png(3, 0), 'empty.png'],
      ['candidates', Buffer.from('not an image'), 'junk.png'],
      ['candidates', await png(3), 'ok.png'],
    ]);
    const body = await (await fetch(`${base}/match`, { method: 'POST', body: fd })).json();
    expect(body.results.map((c) => c.status)).toEqual(['no_face', 'invalid_image', 'ok']);
    expect(body.results[2].match).toBe(true);
    expect(body.results[1].filename).toBe('junk.png');
  });

  it('reports an invalid face index', async () => {
    const { body } = await match(await png(3), [await png(3)], { reference_face: 5 });
    expect(body.reference.status).toBe('invalid_face_index');
  });

  it('rejects malformed candidate_faces and reference_face', async () => {
    const [ref, cand] = [await png(3), await png(3)];
    expect((await match(ref, [cand], { candidate_faces: 'zero:one' })).status).toBe(422);
    expect((await match(ref, [cand], { candidate_faces: '4:0' })).status).toBe(422);
    expect((await match(ref, [cand], { reference_face: 'first' })).status).toBe(422);
  });

  it('rejects a request missing the reference or the candidates', async () => {
    const only = async (name) => (await fetch(`${base}/match`, { method: 'POST', body: form([[name, await png(3), 'x.png']]) })).status;
    expect(await only('reference')).toBe(422);
    expect(await only('candidates')).toBe(422);
    const json = await fetch(`${base}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(json.status).toBe(422);
  });

  it('rejects a photo over the size limit with 413', async () => {
    const huge = Buffer.alloc(26 * 1024 * 1024, 1);
    const { status, body } = await match(huge, [await png(3)]);
    expect(status).toBe(413);
    expect(body.detail).toMatch(/25 MB/);
  });

  it('logs metadata only', async () => {
    logged.length = 0;
    await match(await png(3), [await png(3)]);
    expect(logged).toHaveLength(1);
    expect(logged[0].results[0].score).toBe(1);
    expect(logged[0]).toHaveProperty('elapsed_ms');
    expect(logged[0]).toHaveProperty('request_id');
    expect(JSON.stringify(logged[0])).not.toContain('embedding');
  });

  it('is never cached', async () => {
    const { headers } = await match(await png(3), [await png(3)]);
    expect(headers.get('cache-control')).toBe('no-store');
  });
});

describe('page and assets', () => {
  it('serves the upload page, self-contained and with only relative URLs', async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    // Photos never leave the machine: nothing may load from other sites.
    expect(html).not.toMatch(/https?:\/\//);
    // The page lives under /face-match/, so root-relative URLs would escape to the hub's own routes.
    expect(html).not.toMatch(/(?:src|href)="\//);
    expect(html).not.toMatch(/url\(["']?\//);
    expect(html).not.toMatch(/fetch\(["']\//);
  });

  it('serves the font and the logo the page references', async () => {
    const font = await fetch(`${base}/static/fonts/plus-jakarta-sans-latin-wght-normal.woff2`);
    expect(font.status).toBe(200);
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
    const logo = await fetch(`${base}/static/images/zawadie-logo.png`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
  });

  it('does not serve files outside the static folder', async () => {
    const res = await fetch(`${base}/static/..%2fsrc%2fengine.js`);
    expect(res.status).not.toBe(200);
  });

  it('warms the models when the page is opened', async () => {
    const before = manager.started;
    await fetch(`${base}/`);
    expect(manager.started).toBeGreaterThan(before);
  });

  it('reports health', async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body).toMatchObject({ status: 'ok', ready: true, model: 'fake', threshold: 0.5, possible_threshold: 0.3 });
  });
});

describe('while the model loads', () => {
  it('answers 503, then recovers once the engine is set', async () => {
    const loading = { engine: null, error: null, start: vi.fn() };
    const app = express();
    app.use('/face-match', createRouter({ manager: loading, settings }));
    const s = await new Promise((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
    const url = `http://127.0.0.1:${s.address().port}/face-match`;
    const send = () => fetch(`${url}/match`, { method: 'POST', body: form([['reference', Buffer.from('x'), 'a.png'], ['candidates', Buffer.from('x'), 'b.png']]) });
    try {
      const first = await send();
      expect(first.status).toBe(503);
      expect(first.headers.get('retry-after')).toBe('10');
      expect((await first.json()).detail).toMatch(/loading/);
      expect(loading.start).toHaveBeenCalled();
      expect((await (await fetch(`${url}/health`)).json()).ready).toBe(false);

      loading.error = 'disk full';
      expect((await (await send()).json()).detail).toMatch(/disk full/);
      expect((await (await fetch(`${url}/health`)).json()).load_error).toBe('disk full');

      loading.engine = fakeEngine;
      loading.error = null;
      expect((await send()).status).toBe(200);
    } finally {
      await new Promise((resolve) => s.close(resolve));
    }
  });
});

describe('parseCandidateFaces', () => {
  it('parses pairs and tolerates empty input', () => {
    expect([...parseCandidateFaces('0:1, 2:0', 3)]).toEqual([[0, 1], [2, 0]]);
    expect(parseCandidateFaces('', 1).size).toBe(0);
    expect(parseCandidateFaces(undefined, 1).size).toBe(0);
  });
});

describe('EngineManager', () => {
  const quiet = () => {};

  it('loads lazily, only once, and reports the engine', async () => {
    const factory = vi.fn().mockResolvedValue(fakeEngine);
    const m = new EngineManager({ settings, factory, log: quiet });
    expect(factory).not.toHaveBeenCalled(); // nothing loads until someone asks
    m.start();
    m.start();
    expect(factory).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(m.engine).toBe(fakeEngine));
  });

  it('keeps the error and retries only after the back-off', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const factory = vi.fn().mockRejectedValueOnce(new Error('download blocked')).mockResolvedValue(fakeEngine);
      const m = new EngineManager({ settings, factory, log: quiet });
      m.start();
      await vi.waitFor(() => expect(m.error).toBe('download blocked'));
      m.start();
      expect(factory).toHaveBeenCalledTimes(1); // too soon to retry
      vi.setSystemTime(Date.now() + RETRY_MS + 1);
      m.start();
      expect(factory).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(m.engine).toBe(fakeEngine));
      expect(m.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
