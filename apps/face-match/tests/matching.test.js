import { describe, it, expect } from 'vitest';
import matching from '../src/matching.js';

const { ImageStatus, Verdict, selectFace, cosineScore, matchReference } = matching;

function face(vec) {
  const norm = Math.hypot(...vec);
  return { bbox: [0, 0, 10, 10], detScore: 0.9, embedding: Float32Array.from(vec.map((v) => v / norm)) };
}

describe('selectFace', () => {
  it('flags an undecodable image', () => {
    expect(selectFace('x.jpg', null, null).status).toBe(ImageStatus.INVALID_IMAGE);
  });

  it('flags an image with no face', () => {
    expect(selectFace('x.jpg', [], null).status).toBe(ImageStatus.NO_FACE);
  });

  it('auto-selects a single face', () => {
    const a = selectFace('x.jpg', [face([1, 0])], null);
    expect(a.status).toBe(ImageStatus.OK);
    expect(a.selectedFace).toBe(0);
  });

  it('never guesses among several faces', () => {
    const a = selectFace('x.jpg', [face([1, 0]), face([0, 1])], null);
    expect(a.status).toBe(ImageStatus.MULTIPLE_FACES);
    expect(a.selectedFace).toBeNull();
    expect(a.faces).toHaveLength(2);
    expect(a.embedding).toBeNull();
  });

  it('uses an explicit face index', () => {
    const a = selectFace('x.jpg', [face([1, 0]), face([0, 1])], 1);
    expect(a.status).toBe(ImageStatus.OK);
    expect(Array.from(a.embedding)).toEqual([0, 1]);
  });

  it.each([2, -1, 1.5])('rejects out-of-range index %s', (index) => {
    expect(selectFace('x.jpg', [face([1, 0]), face([0, 1])], index).status).toBe(ImageStatus.INVALID_FACE_INDEX);
  });
});

describe('scoring', () => {
  it('clamps cosine similarity to [0, 1]', () => {
    expect(cosineScore([1, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(cosineScore([1, 0], [-1, 0])).toBe(0);
  });

  it('scores each candidate against the threshold', () => {
    const ref = selectFace('ref.jpg', [face([1, 0])], null);
    const same = selectFace('a.jpg', [face([0.9, 0.1])], null);
    const other = selectFace('b.jpg', [face([0.1, 0.9])], null);
    const missing = selectFace('c.jpg', [], null);

    const report = matchReference(ref, [same, other, missing], 0.5);

    expect(report.candidates.map((c) => c.match)).toEqual([true, false, null]);
    expect(report.candidates[2].score).toBeNull();
    expect(report.complete).toBe(false);
  });

  describe('three outcomes', () => {
    // Candidates at known angles from the reference: score = cos(angle).
    const at = (score) => selectFace('c.jpg', [face([score, Math.sqrt(1 - score * score)])], null);
    const ref = selectFace('ref.jpg', [face([1, 0])], null);
    const verdicts = (scores, match, possible) =>
      matchReference(ref, scores.map(at), match, possible).candidates.map((c) => c.verdict);

    it('sorts a score into match, possible or no match', () => {
      expect(verdicts([0.8, 0.5, 0.1], 0.6, 0.3)).toEqual([Verdict.MATCH, Verdict.POSSIBLE, Verdict.NO_MATCH]);
    });

    it('counts a score exactly on a line as the higher outcome', () => {
      const report = matchReference(ref, [at(0.6), at(0.3)], cosineScore([1, 0], [0.6, 0.8]), cosineScore([1, 0], [0.3, Math.sqrt(0.91)]));
      expect(report.candidates.map((c) => c.verdict)).toEqual([Verdict.MATCH, Verdict.POSSIBLE]);
    });

    it('sets match true only for a confident match', () => {
      const r = matchReference(ref, [at(0.8), at(0.5), at(0.1)], 0.6, 0.3);
      expect(r.candidates.map((c) => c.match)).toEqual([true, false, false]);
    });

    it('removes the possible band when the match line is set below the possible line', () => {
      const r = matchReference(ref, [at(0.5), at(0.1)], 0.2, 0.3);
      expect(r.possibleThreshold).toBe(0.2);
      expect(r.candidates.map((c) => c.verdict)).toEqual([Verdict.MATCH, Verdict.NO_MATCH]);
    });

    it('treats a missing possible line as the match line, i.e. the old two-outcome behaviour', () => {
      expect(verdicts([0.8, 0.5], 0.6)).toEqual([Verdict.MATCH, Verdict.NO_MATCH]);
    });

    it('gives unscored candidates no verdict', () => {
      const r = matchReference(ref, [selectFace('x.jpg', [], null)], 0.6, 0.3);
      expect(r.candidates[0].verdict).toBeNull();
      expect(r.candidates[0].match).toBeNull();
    });
  });

  it('scores nothing when the reference is unusable', () => {
    const ref = selectFace('ref.jpg', [face([1, 0]), face([0, 1])], null);
    const report = matchReference(ref, [selectFace('a.jpg', [face([1, 0])], null)], 0.5);
    expect(report.candidates[0].score).toBeNull();
    expect(report.candidates[0].match).toBeNull();
  });
});
