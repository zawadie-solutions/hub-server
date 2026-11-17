const path = require('path');
const mammoth = require('mammoth');
// The library itself, not pdf-parse's index.js, which runs a debug self-test
// (reading a sample PDF that isn't shipped) whenever it can't see a parent module.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const SUPPORTED = ['.txt', '.md', '.docx', '.pdf'];

/**
 * Extracts plain text from an uploaded file (multer memory-storage file object).
 */
async function extractText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value.trim();
  }

  if (ext === '.pdf') {
    const result = await pdfParse(file.buffer);
    return result.text.trim();
  }

  if (ext === '.txt' || ext === '.md' || ext === '') {
    return file.buffer.toString('utf-8').trim();
  }

  throw new Error(`Unsupported file type "${ext}". Upload one of: ${SUPPORTED.join(', ')}`);
}

// Images the work check can look at (screenshots, photos, designs).
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

// What the file's first bytes say it is, so a renamed file isn't trusted by its name.
function sniffImage(buffer) {
  const b = buffer || Buffer.alloc(0);
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const isImageName = (name) => Object.prototype.hasOwnProperty.call(IMAGE_TYPES, path.extname(name || '').toLowerCase());

/**
 * { buffer, mimetype } for an image file, null for anything that isn't named
 * as an image. Throws if it's named as one but isn't really, or is too big.
 */
function imageOf({ originalname, buffer }) {
  if (!isImageName(originalname)) return null;
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('That image is over 15 MB');
  const mimetype = sniffImage(buffer);
  if (!mimetype) throw new Error('That file isn\'t a readable PNG, JPG, WebP or GIF image');
  return { buffer, mimetype };
}

// Everything the work check accepts: documents and images.
const WORK_SUPPORTED = [...SUPPORTED, ...Object.keys(IMAGE_TYPES)];

module.exports = { extractText, SUPPORTED, imageOf, isImageName, sniffImage, WORK_SUPPORTED };
