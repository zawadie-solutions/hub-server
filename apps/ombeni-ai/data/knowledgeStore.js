const fs = require('fs');
const path = require('path');

// Multi-document knowledge base with simple on-disk persistence: each document
// is a .txt file in data/knowledge/, tracked by data/knowledge/index.json.
// Lets the Knowledge page add / edit / delete documents and survive restarts.
const DIR = path.join(__dirname, 'knowledge');
const INDEX_FILE = path.join(DIR, 'index.json');
const LEGACY_FILE = path.join(__dirname, 'knowledge-base.txt');

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function docPath(id) {
  return path.join(DIR, `${id}.txt`);
}

function saveIndex(docs) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(docs, null, 2), 'utf-8');
}

function loadIndex() {
  if (fs.existsSync(INDEX_FILE)) {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  }

  // First run: migrate the original Zawadie Knowledge base.docx export
  // (data/knowledge-base.txt) into the new multi-document store.
  const docs = [];
  if (fs.existsSync(LEGACY_FILE)) {
    const id = 'zawadie-knowledge-base';
    const now = new Date().toISOString();
    fs.writeFileSync(docPath(id), fs.readFileSync(LEGACY_FILE, 'utf-8'), 'utf-8');
    docs.push({ id, title: 'Zawadie Knowledge base', addedAt: now, updatedAt: now });
  }
  saveIndex(docs);
  return docs;
}

let index = loadIndex();

function slugify(title) {
  const base = String(title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'document';
}

function uniqueId(title) {
  const base = slugify(title);
  let id = base;
  let n = 1;
  while (index.some(d => d.id === id)) {
    id = `${base}-${++n}`;
  }
  return id;
}

function listDocuments() {
  return index.map(d => {
    let charCount = 0;
    try {
      charCount = fs.readFileSync(docPath(d.id), 'utf-8').length;
    } catch {
      charCount = 0;
    }
    return { ...d, charCount };
  });
}

function getDocument(id) {
  const meta = index.find(d => d.id === id);
  if (!meta) return null;
  const body = fs.existsSync(docPath(id)) ? fs.readFileSync(docPath(id), 'utf-8') : '';
  return { ...meta, body };
}

function addDocument({ title, body }) {
  const id = uniqueId(title);
  const now = new Date().toISOString();
  fs.writeFileSync(docPath(id), body, 'utf-8');
  const meta = { id, title: title || 'Untitled document', addedAt: now, updatedAt: now };
  index.push(meta);
  saveIndex(index);
  return { ...meta, body };
}

function updateDocument(id, { title, body }) {
  const meta = index.find(d => d.id === id);
  if (!meta) return null;
  if (title !== undefined && title.trim()) meta.title = title.trim();
  if (body !== undefined) fs.writeFileSync(docPath(id), body, 'utf-8');
  meta.updatedAt = new Date().toISOString();
  saveIndex(index);
  return getDocument(id);
}

function deleteDocument(id) {
  const i = index.findIndex(d => d.id === id);
  if (i === -1) return false;
  index.splice(i, 1);
  saveIndex(index);
  if (fs.existsSync(docPath(id))) fs.unlinkSync(docPath(id));
  return true;
}

function combinedText() {
  return listDocuments()
    .map(d => `=== ${d.title} ===\n${fs.readFileSync(docPath(d.id), 'utf-8')}`)
    .join('\n\n');
}

module.exports = { listDocuments, getDocument, addDocument, updateDocument, deleteDocument, combinedText };
