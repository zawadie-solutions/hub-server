import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import imaging from '../src/imaging.js';

const { decodeImage, resizeBilinear, padBorder, warpAffine, estimateSimilarity } = imaging;

function gradient(w, h) {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) data[(y * w + x) * 3 + c] = (x * 7 + y * 13 + c * 50) % 256;
  return { data, width: w, height: h };
}

describe('decodeImage', () => {
  it('honors EXIF orientation', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .jpeg()
      .withMetadata({ orientation: 6 }) // stored sideways: must come out rotated, 4 wide and 8 tall
      .toBuffer();
    const img = await decodeImage(jpeg);
    expect(img.width).toBe(4);
    expect(img.height).toBe(8);
  });

  it('drops alpha and returns RGB', async () => {
    const png = await sharp({ create: { width: 5, height: 3, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const img = await decodeImage(png);
    expect(img.data).toHaveLength(5 * 3 * 3);
    expect(Array.from(img.data.slice(0, 3))).toEqual([200, 100, 50]);
  });

  it('returns null for non-images', async () => {
    expect(await decodeImage(Buffer.from('not an image'))).toBeNull();
    expect(await decodeImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('cv2-compatible pixel math', () => {
  it('resizes to the same size as the identity', () => {
    const img = gradient(9, 7);
    expect(Array.from(resizeBilinear(img, 9, 7).data)).toEqual(Array.from(img.data));
  });

  it('keeps a constant image constant', () => {
    const img = { data: new Uint8Array(6 * 6 * 3).fill(123), width: 6, height: 6 };
    expect(Array.from(resizeBilinear(img, 4, 10).data).every((v) => v === 123)).toBe(true);
  });

  it('matches cv2 on a 2x2 -> 4x4 upscale, within one grey level', () => {
    // Reference: cv2.resize(np.array([[0, 100], [200, 50]], np.uint8), (4, 4)). cv2 uses fixed-point
    // weights and truncates an intermediate value, so exact .5 ties can land one level below ours.
    const src = [[0, 100], [200, 50]];
    const data = new Uint8Array(12);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) data.fill(src[y][x], (y * 2 + x) * 3, (y * 2 + x) * 3 + 3);
    const out = resizeBilinear({ data, width: 2, height: 2 }, 4, 4);
    const expected = [[0, 25, 75, 100], [50, 59, 78, 88], [150, 128, 84, 63], [200, 162, 87, 50]];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) expect(Math.abs(out.data[(y * 4 + x) * 3] - expected[y][x])).toBeLessThanOrEqual(1);
    }
  });

  it('pads with a black border and keeps the content', () => {
    const padded = padBorder({ data: new Uint8Array(2 * 2 * 3).fill(9), width: 2, height: 2 }, 3);
    expect([padded.width, padded.height]).toEqual([8, 8]);
    expect(padded.data[0]).toBe(0);
    expect(padded.data[(3 * 8 + 3) * 3]).toBe(9);
    expect(padded.data[(5 * 8 + 5) * 3]).toBe(0);
  });

  it('warps with the identity transform as a copy', () => {
    const img = gradient(10, 10);
    expect(Array.from(warpAffine(img, [[1, 0, 0], [0, 1, 0]], 10, 10).data)).toEqual(Array.from(img.data));
  });

  it('shifts content on translation and fills the border with zeros', () => {
    const img = { data: new Uint8Array(4 * 4 * 3).fill(200), width: 4, height: 4 };
    const out = warpAffine(img, [[1, 0, 2], [0, 1, 0]], 4, 4);
    expect(out.data[0]).toBe(0);
    expect(out.data[(0 * 4 + 1) * 3]).toBe(0);
    expect(out.data[(0 * 4 + 2) * 3]).toBe(200);
  });

  it('recovers a known rotation, scale and translation', () => {
    const theta = 0.35;
    const s = 0.8;
    const a = s * Math.cos(theta);
    const b = s * Math.sin(theta);
    const src = [[10, 20], [60, 25], [35, 50], [18, 80], [55, 82]];
    const dst = src.map(([x, y]) => [a * x - b * y + 5, b * x + a * y - 7]);
    const M = estimateSimilarity(src, dst);
    const expected = [[a, -b, 5], [b, a, -7]];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) expect(M[r][c]).toBeCloseTo(expected[r][c], 9);
  });
});
