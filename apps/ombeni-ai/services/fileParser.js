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

module.exports = { extractText, SUPPORTED };
