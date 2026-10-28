// Loads docs/PlaybookKeyFacts.md (or another file) as clean, verified playbook chunks: one chunk per "## " section.
// They attach to the ACTIVE playbook, so run `npm run ingest` first. Re-running replaces the previous load.
// Usage: npm run load:facts [-- docs/PlaybookKeyFacts.md] [--dry-run]
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--')) || 'docs/PlaybookKeyFacts.md';
const source = path.basename(file);

const sections = fs.readFileSync(file, 'utf8').split(/^## /m).slice(1).map((block) => {
  const [heading, ...rest] = block.split('\n');
  return { heading: heading.trim(), body: rest.join('\n').trim() };
}).filter((s) => s.body);

console.log(`Found ${sections.length} sections in ${file}`);
if (dryRun) {
  sections.forEach((s) => console.log(`- ${s.heading} (${s.body.length} chars)`));
  process.exit(0);
}

const { default: pool } = await import('../src/config/db.js');
const { generateEmbeddings, insertChunk } = await import('../src/services/ragService.js');
const { quarterTag } = await import('../src/services/playbookService.js');

try {
  const [pbRows] = await pool.execute('SELECT id, quarter, year FROM playbooks WHERE is_active = 1 LIMIT 1');
  const playbook = pbRows[0];
  if (!playbook) throw new Error('No active playbook. Run `npm run ingest` first.');
  const tag = quarterTag(playbook.year, playbook.quarter);

  await pool.execute("DELETE FROM knowledge_chunks WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = ?", [source]);
  const texts = sections.map((s) => `${s.heading}\n${s.body}`);
  const vectors = await generateEmbeddings(texts);
  for (let i = 0; i < sections.length; i++) {
    await insertChunk({
      playbookId: playbook.id, chunkType: 'playbook', content: texts[i], embedding: vectors[i],
      quarter: tag, isActive: true,
      metadata: { source, kind: 'key_facts', heading: sections[i].heading }
    });
  }
  console.log(`Loaded ${sections.length} key-fact chunks into playbook ${playbook.id} (${tag}).`);
} catch (err) {
  console.error('Load failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
