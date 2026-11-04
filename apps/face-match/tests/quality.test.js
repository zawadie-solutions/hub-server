import { describe, it, expect } from 'vitest';
import quality from '../src/quality.js';

const { assessQuality, sharpness, SMALL_FACE_PX, BLURRY_SHARPNESS, TURNED_HEAD } = quality;

const SIZE = 112;
const crop = (fn) => {
  const data = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) data.fill(fn(x, y), (y * SIZE + x) * 3, (y * SIZE + x) * 3 + 3);
  return { data, width: SIZE, height: SIZE };
};
// Hard edges everywhere (sharp) versus a smooth ramp (blurry).
const sharpCrop = crop((x, y) => ((x >> 1) + (y >> 1)) % 2 ? 230 : 25);
const blurryCrop = crop((x, y) => 30 + x + y); // stays within 0-255; a byte array would wrap, creating a hard edge
const flatCrop = crop(() => 128);

// Landmarks: left eye, right eye, nose, left mouth, right mouth. Eye distance is 32.
const frontal = [[40, 50], [72, 50], [56, 70], [42, 92], [70, 92]];
const turned = (noseX) => [[40, 50], [72, 50], [noseX, 70], [42, 92], [70, 92]];
const bigBox = [0, 0, 200, 220];

describe('sharpness', () => {
  it('is high for edges and low for smooth or flat images', () => {
    expect(sharpness(sharpCrop)).toBeGreaterThan(BLURRY_SHARPNESS * 10);
    expect(sharpness(blurryCrop)).toBeLessThan(BLURRY_SHARPNESS);
    expect(sharpness(flatCrop)).toBe(0);
  });
});

describe('assessQuality', () => {
  it('reports no issues for a large, sharp, frontal face', () => {
    const q = assessQuality({ box: bigBox, kps: frontal, crop: sharpCrop });
    expect(q).toMatchObject({ level: 'good', issues: [], face_px: 200, head_turn: 0 });
    expect(q.sharpness).toBeGreaterThan(BLURRY_SHARPNESS);
  });

  it('flags a small face by its shorter side', () => {
    expect(assessQuality({ box: [0, 0, 400, SMALL_FACE_PX - 1], kps: frontal, crop: sharpCrop }).issues).toEqual(['small_face']);
    expect(assessQuality({ box: [0, 0, 400, SMALL_FACE_PX], kps: frontal, crop: sharpCrop }).issues).toEqual([]);
  });

  it('flags a blurry crop', () => {
    expect(assessQuality({ box: bigBox, kps: frontal, crop: blurryCrop }).issues).toEqual(['blurry']);
  });

  it('flags a head turned to the side, in either direction', () => {
    const eyeMid = 56;
    const offset = TURNED_HEAD * 32; // eye distance is 32
    expect(assessQuality({ box: bigBox, kps: turned(eyeMid + offset), crop: sharpCrop }).issues).toEqual(['turned_head']);
    expect(assessQuality({ box: bigBox, kps: turned(eyeMid - offset), crop: sharpCrop }).issues).toEqual(['turned_head']);
    expect(assessQuality({ box: bigBox, kps: turned(eyeMid + offset - 2), crop: sharpCrop }).issues).toEqual([]);
  });

  it('grades by the number of issues', () => {
    const one = assessQuality({ box: [0, 0, 50, 50], kps: frontal, crop: sharpCrop });
    expect([one.level, one.issues]).toEqual(['fair', ['small_face']]);
    const two = assessQuality({ box: [0, 0, 50, 50], kps: frontal, crop: blurryCrop });
    expect([two.level, two.issues]).toEqual(['poor', ['small_face', 'blurry']]);
  });

  it('does not divide by zero when the eyes coincide', () => {
    const degenerate = [[50, 50], [50, 50], [56, 70], [42, 92], [70, 92]];
    expect(assessQuality({ box: bigBox, kps: degenerate, crop: sharpCrop }).head_turn).toBe(0);
  });
});
