import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Client } from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Add it to .env, e.g.:\n  DATABASE_URL=postgres://...')
    process.exit(1)
  }

  const sql = readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Migration applied: users, sessions, progress tables are ready.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
