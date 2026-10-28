// Loads per-store knowledge chunks (schools / demographics / events) from a markdown file whose
// ```json blocks look like { "location_id", "chunk_type", "content" }. Also updates store names/addresses
// from "(location_id: x) - Store: Name (street, City, ST ZIP)" lines.
// Usage: npm run seed:local [-- docs/TestData.md] [--dry-run]
// Re-running replaces the chunks previously loaded from the same file (no duplicates).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--')) || 'docs/TestData.md';
const source = path.basename(file);
const VALID = ['demographic', 'school', 'event'];

const md = fs.readFileSync(file, 'utf8');

const chunks = [...md.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => JSON.parse(m[1])).map((c) => {
  // "demographic_event" (combined) is stored as demographic; the original label is kept in metadata.
  const type = VALID.includes(c.chunk_type) ? c.chunk_type : 'demographic';
  return { locationId: c.location_id, chunkType: type, content: c.content, metadata: { source, original_type: c.chunk_type } };
});

const stores = [...md.matchAll(/location_id: ([\w-]+)`?\)\s*\n\s*- Store: (.+?) \((.+?), (.+?), ([A-Z]{2}) (\d{5})\)/g)]
  .map(([, id, name, address, city, state, zip]) => ({ id, name, address, city, state, zip }));

console.log(`Found ${chunks.length} chunks and ${stores.length} store records in ${file}`);
if (dryRun) {
  chunks.forEach((c) => console.log(`- ${c.locationId} [${c.chunkType}${c.metadata.original_type !== c.chunkType ? ` <- ${c.metadata.original_type}` : ''}] ${c.content.slice(0, 60)}...`));
  process.exit(0);
}

const { default: pool } = await import('../src/config/db.js');
const { generateEmbeddings, insertChunk } = await import('../src/services/ragService.js');

try {
  for (const s of stores) {
    await pool.execute(
      'UPDATE stores SET name = ?, address = ?, city = ?, state = ?, zip = ? WHERE location_id = ?',
      [s.name, s.address, s.city, s.state, s.zip, s.id]
    );
  }
  const [known] = await pool.execute('SELECT location_id FROM stores');
  const ids = new Set(known.map((r) => r.location_id));
  const usable = chunks.filter((c) => ids.has(c.locationId));
  if (usable.length !== chunks.length) console.warn(`Skipping ${chunks.length - usable.length} chunk(s) for unknown stores.`);

  await pool.execute("DELETE FROM knowledge_chunks WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = ?", [source]);
  const vectors = await generateEmbeddings(usable.map((c) => c.content));
  for (let i = 0; i < usable.length; i++) {
    await insertChunk({ ...usable[i], embedding: vectors[i] });
  }
  console.log(`Loaded ${usable.length} chunks for: ${[...new Set(usable.map((c) => c.locationId))].join(', ')}`);
} catch (err) {
  console.error('Seed failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
