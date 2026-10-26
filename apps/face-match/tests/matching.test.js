import { describe, it, expect } from 'vitest';
import matching from '../src/matching.js';

const { ImageStatus, selectFace, cosineScore, matchReference } = matching;

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

  it('scores nothing when the reference is unusable', () => {
    const ref = selectFace('ref.jpg', [face([1, 0]), face([0, 1])], null);
    const report = matchReference(ref, [selectFace('a.jpg', [face([1, 0])], null)], 0.5);
    expect(report.candidates[0].score).toBeNull();
    expect(report.candidates[0].match).toBeNull();
  });
});
