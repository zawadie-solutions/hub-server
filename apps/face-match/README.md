# Face Match

Compares one reference photo with one or more newer photos and says, for each, whether it is the same
person (a similarity score plus a match / no-match verdict). It compares face embeddings; it does not
identify people, and it is not a search or surveillance tool. Built for adult-to-adult comparison
across years of ageing.

This is the Node.js port of the original Python/FastAPI app (`Face-match-system`), built in so the hub
can run it on a Node-only plan. It runs inside the hub's process at `/face-match`, behind the hub's
login and per-solution access check, so it has no login of its own.

## How it works

- `src/hub.js` is the entry the hub loads (see `solutions.js`). It returns an Express router.
- `src/engine.js` replaces the Python `insightface` package: RetinaFace/SCRFD detection, 5-point
  alignment and ArcFace R50 embeddings on `onnxruntime-node`, CPU only. Same models (`buffalo_l`).
- `src/imaging.js` decodes photos with `sharp` (phone-photo rotation honored). The resize and warp are
  hand-written to mimic OpenCV on purpose. Do not swap them for sharp's resize: a different
  interpolation shifts every embedding and invalidates the calibrated threshold.
- `src/router.js` is the API: `GET /` (page), `GET /health`, `POST /match`.
- `src/manager.js` loads the models **on first use** (opening the page is the cue), not at hub start,
  so the hub's other solutions don't carry ~600 MB of RAM until someone uses Face Match.
- `static/` is the upload page (inline CSS/JS, local font and logo, nothing loaded from other sites).
  All its URLs are relative, because it lives under `/face-match/`.

`POST /match` takes multipart `reference` and `candidates` files, plus optional `reference_face`,
`candidate_faces` (`"cand:face,..."`) and `threshold` (the match line, see below). It answers 200 with
a status per image (`ok`, `no_face`, `multiple_faces`, `invalid_image`, `invalid_face_index`); the
engine never picks one of several faces itself. 422 means a malformed parameter, 503 means the models
are still loading.

## Three outcomes

Each scored candidate gets a `verdict`, from its cosine similarity score (0 to 1):

| Verdict | Score | Meaning |
|---|---|---|
| `match` | at or above the **match line** (0.45) | Same person. No different-person pair in the benchmark scored this high (adult FG-NET pairs and CFP-FP: 0.000% false matches; 0.008% across all FG-NET pairs, childhood photos included). |
| `possible` | from the **possible line** (0.2589) up to the match line | Maybe the same person; a human should look. 0.2589 is the FG-NET threshold at 1% false matches. |
| `no_match` | below the possible line | Different person. |

`match` in the response is `true` only for a confident match; `verdict` carries the three-way answer.
The `threshold` form field moves the match line only. If it is set below the possible line there is
no possible band (the possible line never sits above the match line), and the response's
`possible_threshold` shows the line actually used.

Why not one line: a single strict line (say 0.50) almost never wrongly matches, but on the benchmark it
also misses about 1 in 7 true adult matches (85% recognised) and half of the profile-angle pairs, and
only half of pairs 30+ years apart. A single lenient line (0.26) accepts about 1 in 150 different-person
pairs. Three outcomes keep the strict line's safety and stop true matches from being reported as
"different person".

## Photo-quality warnings

Each detected face carries `quality: {level, issues, face_px, sharpness, head_turn}`, and the page
shows a note when the reference or the candidate has an issue:

| Issue | Rule | What the measurement showed |
|---|---|---|
| `small_face` | shorter side of the face box under 80 px | Flags 1% of good photos; when it fired, the match was lost 9 times in 10 |
| `blurry` | Laplacian variance of the aligned 112 px crop under 100 | Flags 0% of good CFP photos, 11% of old FG-NET scans; when it fired, the match was lost 19 times in 20 |
| `turned_head` | nose offset from the eye midpoint at least 1.0 eye distances | Weak evidence: median score 0.46 against 0.52, from only 20 pairs per group |

These rules were chosen from measurements on 80 same-person CFP pairs with the second photo degraded
(blur, shrink-and-enlarge, heavy JPEG, all three). Warnings **never change the verdict**, and they
catch only about a quarter of the matches that degradation cost: most losses show no simple image
signal. The possible band is what catches those, so do not read "no warning" as "reliable".
Tried and rejected: low detection confidence (weak predictor, flags 16% of old scans) and the model's
feature norm (it rises, not falls, when photos degrade).

## Settings

Defaults are in `config/facematch.json`. Override in the hub's `.env`:

| Variable | Meaning |
|---|---|
| `FACEMATCH_THREADS` | CPU threads per model run (default 3). See below. |
| `FACEMATCH_PRELOAD` | `1` loads the models at hub start instead of on first use. |
| `FACEMATCH_MATCH_THRESHOLD` | Override the match line (0 to 1). Don't, without a new measurement. |
| `FACEMATCH_POSSIBLE_THRESHOLD` | Override where "possible" starts. Must not be above the match line. |
| `FACEMATCH_MODEL_DIR` | Where the two model files live. |

**Models:** `det_10g.onnx` and `w600k_r50.onnx` from the InsightFace `buffalo_l` pack. The first use
downloads them (about 280 MB, a minute or two) into `~/.insightface/models/buffalo_l/`, which sits
outside the app folder and survives redeploys. Until then `/health` shows `"ready": false` and
`/match` answers 503 with a readable message. If the download is blocked, put the two files in a
folder and set `FACEMATCH_MODEL_DIR`.

**Threads:** the host reports every core on the machine but gives an account only a few. onnxruntime
sizes its thread pool from the reported cores, and on Hostinger the default was 7x slower than 3
threads (2.4 s vs 0.35 s for the models alone). If the plan or the server load changes, re-measure.

**Logs:** one JSON line per request in `logs/facematch.log` (git-ignored), metadata only: file names,
statuses, scores, timings. Never add embeddings or pixels to it. Hosting platforms may replace the
app folder on deploy; set `log_path` to an absolute path to keep it.

## Accuracy

The possible line (0.2589) was measured on the Python pipeline at FAR = 1% on FG-NET. The Node engine
was benchmarked against the same data and gave the same results at that line:

| Target | Python | Node | Goal |
|---|---|---|---|
| Age gap, adult pairs (FG-NET): TAR / FAR | 99.48% / 0.66% | 99.48% / 0.64% | TAR ≥ 90%, FAR ≤ 1% |
| Pose (CFP-FP): TAR / FAR | 96.29% / 0.00% | 96.26% / 0.00% | TAR ≥ 85%, FAR ≤ 1% |

At the match line (0.45) the same benchmark gives: adult FG-NET pairs 93.1% recognised at 0.000% false
matches, CFP-FP 67.3% at 0.000%. So a confident match is rarer than a "possible" one, by design.
Scores in the middle band are a judgement call for a person, not a failure of the tool.

Per-pair scores differ from Python by 0.0013 on average. The alignment and embedding stages are exact
given the same landmarks; the small remaining difference comes from OpenCV's image resize, which can't
be reproduced bit for bit.

The benchmark harness (Python: scikit-learn, matplotlib, the FG-NET and CFP datasets) is **not part of
this repo**. These numbers come from running it against this engine's code in October 2026. After any
change to detection, alignment or the model, the benchmark has to be re-run before trusting the
threshold; a pipeline that produces different embeddings needs its own measurement.

## Tests

```bash
npx vitest run apps/face-match
```

They use a fake detector and need no model, so they don't prove the real engine works. For that, open
Face Match in a running hub and compare two photos of the same person and one of someone else.

## Licence and data

- The InsightFace pretrained weights are for **non-commercial use only**. Keep that in mind before
  using Face Match for anything beyond internal, personal-scale checks.
- Face embeddings are biometric data. Photos are processed in memory and dropped; nothing is stored.
  Settle consent and retention before adding any persistence (saved photos, saved embeddings).
- Speed: a match takes roughly one CPU-second on 3 threads. While someone runs a comparison, the other
  solutions share that CPU.
