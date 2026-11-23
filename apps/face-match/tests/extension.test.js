import { describe, it, expect } from 'vitest';
import {
  BATCH_SIZE, buildMatchForm, chunk, classify, hubProblem, normalizeHubUrl, originOf, pickGalleryImages,
  qualityIssues, referenceProblem, summarize,
} from '../extension/lib.js';

describe('normalizeHubUrl', () => {
  it('accepts an https address and strips trailing slashes', () => {
    expect(normalizeHubUrl('https://hub.example.com/face-match/')).toEqual({ ok: true, url: 'https://hub.example.com/face-match', origin: 'https://hub.example.com' });
  });
  it('adds /face-match when only the hub address is given', () => {
    expect(normalizeHubUrl('https://hub.example.com').url).toBe('https://hub.example.com/face-match');
    expect(normalizeHubUrl(' https://hub.example.com/ ').url).toBe('https://hub.example.com/face-match');
  });
  it('allows plain http only for localhost', () => {
    expect(normalizeHubUrl('http://localhost:8100/face-match').ok).toBe(true);
    expect(normalizeHubUrl('http://127.0.0.1:8100').ok).toBe(true);
    const bad = normalizeHubUrl('http://hub.example.com/face-match');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/https/);
  });
  it.each(['', 'hub.example.com', 'ftp://hub.example.com', 'javascript:alert(1)', 'not a url'])('rejects %j', (input) => {
    expect(normalizeHubUrl(input).ok).toBe(false);
  });
});

describe('originOf', () => {
  it('gives the origin of web addresses and nothing for others', () => {
    expect(originOf('https://cdn.example.com/a/b.jpg?x=1')).toBe('https://cdn.example.com');
    expect(originOf('http://localhost:3000/x.png')).toBe('http://localhost:3000');
    expect(originOf('data:image/png;base64,AAAA')).toBeNull();
    expect(originOf('blob:https://example.com/123')).toBeNull();
    expect(originOf('nonsense')).toBeNull();
  });
});

describe('pickGalleryImages', () => {
  const img = (url, width = 400, height = 500) => ({ url, width, height });
  it('keeps photos and drops icons, banners, the profile photo and duplicates', () => {
    const out = pickGalleryImages(
      [img('a'), img('b'), img('a'), img('icon', 32, 32), img('small', 119, 300), img('banner', 1200, 200), img('tall', 100, 900), img('profile'), img('c', 120, 120)],
      'profile',
    );
    expect(out.map((i) => i.url)).toEqual(['a', 'b', 'c']);
  });
  it('ignores images with no address', () => {
    expect(pickGalleryImages([img(''), img(undefined), img('ok')], null).map((i) => i.url)).toEqual(['ok']);
  });
  it('caps the gallery size', () => {
    const many = Array.from({ length: 500 }, (_, i) => img(`p${i}`));
    expect(pickGalleryImages(many, null, { max: 50 })).toHaveLength(50);
  });
});

describe('chunk', () => {
  it('splits into batches, keeping the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(BATCH_SIZE).toBeLessThanOrEqual(50); // the hub's per-request file limit
  });
});

describe('buildMatchForm', () => {
  it('sends neutral names, one reference, every candidate and any_face', () => {
    const form = buildMatchForm(new Blob(['r']), [new Blob(['a']), new Blob(['b'])]);
    const files = [...form.entries()].filter(([, v]) => typeof v !== 'string');
    expect(files.map(([k, v]) => [k, v.name])).toEqual([['reference', 'profile.jpg'], ['candidates', 'gallery-0.jpg'], ['candidates', 'gallery-1.jpg']]);
    expect(form.get('any_face')).toBe('1');
  });
});

describe('classify', () => {
  const face = (issues) => ({ quality: { issues } });
  it('maps verdicts to what a reviewer sees', () => {
    expect(classify({ status: 'ok', verdict: 'match', score: 0.7, faces: [face([])], selected_face: 0 })).toMatchObject({ kind: 'match', score: 0.7 });
    expect(classify({ status: 'ok', verdict: 'possible', score: 0.4, faces: [face([])], selected_face: 0 }).kind).toBe('possible');
    expect(classify({ status: 'ok', verdict: 'no_match', score: 0.1, faces: [face([])], selected_face: 0 }).kind).toBe('no_match');
  });
  it('treats a photo without a face as normal, and an unreadable one as unreadable', () => {
    expect(classify({ status: 'no_face', faces: [] }).kind).toBe('no_face');
    expect(classify({ status: 'invalid_image', faces: [] }).kind).toBe('unreadable');
  });
  it('carries the quality issues of the face that was used', () => {
    const r = { status: 'ok', verdict: 'no_match', score: 0.1, selected_face: 1, faces: [face([]), face(['blurry', 'small_face'])] };
    expect(classify(r).issues).toEqual(['the photo is blurry', 'the face is small']);
  });
});

describe('qualityIssues', () => {
  it('is empty when the hub reported none, or nothing was selected', () => {
    expect(qualityIssues({ selected_face: null, faces: [] })).toEqual([]);
    expect(qualityIssues({ selected_face: 0, faces: [{}] })).toEqual([]);
    expect(qualityIssues({ selected_face: 0, faces: [{ quality: { issues: ['unknown_code'] } }] })).toEqual([]);
  });
});

describe('summarize', () => {
  it('reads as a sentence, with the right plurals', () => {
    expect(summarize(['match', 'match', 'possible', 'no_match', 'no_face'])).toBe(
      'Checked 5 gallery photos: 2 match the profile photo, 1 possible, 1 with no match, 1 without a face.');
    expect(summarize(['match'])).toBe('Checked 1 gallery photo: 1 matches the profile photo.');
    expect(summarize([])).toBe('Checked 0 gallery photos: nothing to report.');
  });
});

describe('hubProblem', () => {
  const res = (over) => ({ ok: true, status: 200, type: 'basic', ...over });
  it('is null for a good answer', () => expect(hubProblem(res({}))).toBeNull());
  it('spots a sign-in redirect and an unauthorised answer', () => {
    expect(hubProblem(res({ ok: false, status: 0, type: 'opaqueredirect' })).kind).toBe('login');
    expect(hubProblem(res({ ok: false, status: 401 })).kind).toBe('login');
  });
  it('tells the other cases apart', () => {
    expect(hubProblem(res({ ok: false, status: 403 })).kind).toBe('no_access');
    expect(hubProblem(res({ ok: false, status: 503 })).kind).toBe('loading');
    expect(hubProblem(res({ ok: false, status: 413 })).kind).toBe('too_large');
    expect(hubProblem(res({ ok: false, status: 500 })).kind).toBe('error');
  });
});

describe('referenceProblem', () => {
  it('explains why the profile photo cannot be used', () => {
    expect(referenceProblem({ status: 'ok' })).toBeNull();
    expect(referenceProblem({ status: 'no_face' })).toMatch(/No face/);
    expect(referenceProblem({ status: 'multiple_faces' })).toMatch(/more than one face/);
    expect(referenceProblem({ status: 'invalid_image' })).toMatch(/read/);
    expect(referenceProblem({ status: 'invalid_face_index' })).toMatch(/can't be used/);
  });
});
