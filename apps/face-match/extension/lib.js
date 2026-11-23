// Pure helpers for the side panel: no Chrome APIs here, so they can be unit-tested in Node.

export const MIN_PHOTO_PX = 120; // smaller images are icons and avatars, not gallery photos
export const BATCH_SIZE = 10; // gallery photos per request to the hub (the hub accepts up to 50 files)
export const MAX_GALLERY = 200;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // the hub rejects a photo over 25 MB

/** Validate the hub address the reviewer typed. Plain http is only allowed for localhost. */
export function normalizeHubUrl(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch {
    return { ok: false, error: 'Enter the full hub address, for example https://hub.example.com/face-match' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'The hub address must start with https://' };
  }
  if (u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    return { ok: false, error: 'Use https://. Plain http would send photos and your sign-in in the clear.' };
  }
  const path = u.pathname.replace(/\/+$/, '') || '/face-match';
  return { ok: true, url: u.origin + path, origin: u.origin };
}

/** "https://cdn.example.com/a/b.jpg" -> "https://cdn.example.com", or null for data:, blob: and junk. */
export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Which images on the page count as gallery photos: big enough, not banner-shaped, not the profile photo
 * itself, each address once. `images` is [{url, width, height}] with natural sizes.
 */
export function pickGalleryImages(images, referenceUrl, { minPx = MIN_PHOTO_PX, max = MAX_GALLERY } = {}) {
  const seen = new Set();
  const out = [];
  for (const img of images) {
    if (!img.url || img.url === referenceUrl || seen.has(img.url)) continue;
    if (img.width < minPx || img.height < minPx) continue;
    const ratio = img.width / img.height;
    if (ratio > 3 || ratio < 1 / 3) continue; // banners and dividers are not photos of a person
    seen.add(img.url);
    out.push(img);
    if (out.length >= max) break;
  }
  return out;
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What to send the hub: neutral file names, so the hub's log never holds a user's own file names. */
export function buildMatchForm(referenceBlob, galleryBlobs) {
  const form = new FormData();
  form.append('reference', referenceBlob, 'profile.jpg');
  galleryBlobs.forEach((blob, i) => form.append('candidates', blob, `gallery-${i}.jpg`));
  form.append('any_face', '1'); // a gallery has group photos: use the face that matches best
  return form;
}

const QUALITY_TEXT = {
  small_face: 'the face is small',
  blurry: 'the photo is blurry',
  turned_head: 'the head is turned to the side',
};

/** Plain-language quality issues of the face the hub used in a result (empty if none were reported). */
export function qualityIssues(result) {
  const face = result && result.selected_face != null ? result.faces[result.selected_face] : null;
  return ((face && face.quality && face.quality.issues) || []).map((code) => QUALITY_TEXT[code]).filter(Boolean);
}

/** One row for the reviewer from one hub result for a gallery photo. */
export function classify(result) {
  if (result.status === 'no_face') return { kind: 'no_face', label: 'No face found', score: null };
  if (result.status !== 'ok') return { kind: 'unreadable', label: "Couldn't read this photo", score: null };
  const base = { score: result.score, faces: result.faces.length, issues: qualityIssues(result) };
  if (result.verdict === 'match') return { kind: 'match', label: 'Matches profile photo', ...base };
  if (result.verdict === 'possible') return { kind: 'possible', label: 'Possible match', ...base };
  return { kind: 'no_match', label: 'No match to profile photo', ...base };
}

/** Rows a reviewer should look at first come first. */
export const REVIEW_ORDER = ['no_match', 'possible', 'unreadable', 'match', 'no_face'];

export function summarize(kinds) {
  const count = (k) => kinds.filter((x) => x === k).length;
  const parts = [];
  if (count('match')) parts.push(`${count('match')} match${count('match') === 1 ? 'es' : ''} the profile photo`);
  if (count('possible')) parts.push(`${count('possible')} possible`);
  if (count('no_match')) parts.push(`${count('no_match')} with no match`);
  if (count('no_face')) parts.push(`${count('no_face')} without a face`);
  if (count('unreadable')) parts.push(`${count('unreadable')} unreadable`);
  const n = kinds.length;
  return `Checked ${n} gallery photo${n === 1 ? '' : 's'}: ${parts.join(', ') || 'nothing to report'}.`;
}

/** Turn a hub HTTP response into a problem for the reviewer, or null if it is fine. */
export function hubProblem(response) {
  if (response.type === 'opaqueredirect') return { kind: 'login', message: 'Sign in to the Zawadie hub, then check again.' };
  if (response.status === 401) return { kind: 'login', message: 'Sign in to the Zawadie hub, then check again.' };
  if (response.status === 403) return { kind: 'no_access', message: "Your hub account doesn't have access to Face Match. Ask an admin to grant it." };
  if (response.status === 503) return { kind: 'loading', message: 'The face model is still loading on the server. Try again in a minute.' };
  if (response.status === 413) return { kind: 'too_large', message: 'A photo is too large for the hub (limit 25 MB).' };
  if (!response.ok) return { kind: 'error', message: `The hub answered with an error (${response.status}).` };
  return null;
}

/** Why the profile photo can't be used, in words, or null when it is fine. */
export function referenceProblem(reference) {
  switch (reference.status) {
    case 'ok': return null;
    case 'no_face': return 'No face was found in the profile photo.';
    case 'multiple_faces': return 'The profile photo shows more than one face, so it is unclear which one to use.';
    case 'invalid_image': return "The profile photo couldn't be read.";
    default: return "The profile photo can't be used.";
  }
}
