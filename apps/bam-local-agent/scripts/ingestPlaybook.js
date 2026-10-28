// Usage:
//   node scripts/ingestPlaybook.js <file.pdf|.txt|.md> <quarter 1-4> <year>
//   node scripts/ingestPlaybook.js <file> 2026-Q2
//   add --dry-run to extract + chunk only (no OpenAI calls, no database writes)
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [file, a, b] = args.filter((x) => x !== '--dry-run');

let quarter, year;
const tag = a?.match(/^(\d{4})-Q([1-4])$/i);
if (tag) { year = Number(tag[1]); quarter = Number(tag[2]); } else { quarter = Number(a); year = Number(b); }

if (!file || !(quarter >= 1 && quarter <= 4) || !(year >= 2000)) {
  console.error('Usage: node scripts/ingestPlaybook.js <file.pdf|.txt|.md> <quarter 1-4> <year> [--dry-run]');
  process.exit(1);
}

const { extractText, chunkText, ingestPlaybook } = await import('../src/services/playbookService.js');
const { default: pool } = await import('../src/config/db.js');

try {
  const buffer = fs.readFileSync(file);
  const filename = path.basename(file);
  if (dryRun) {
    const chunks = chunkText(await extractText(buffer, filename));
    console.log(`${chunks.length} chunks (avg ${Math.round(chunks.reduce((n, c) => n + c.length, 0) / chunks.length)} chars)`);
    console.log('--- first chunk ---\n' + chunks[0]);
  } else {
    const result = await ingestPlaybook(buffer, {
      filename, quarter, year,
      onProgress: (e) => { if (e.stage === 'embedding' && e.done) console.log(`Embedded ${e.done}/${e.total} chunks`); }
    });
    console.log('Ingested and activated:', result);
  }
} catch (err) {
  console.error('Ingest failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
