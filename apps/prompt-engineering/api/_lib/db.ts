import { neon } from '@neondatabase/serverless'

// Inside the Zawadie hub, DATABASE_URL is the hub's own (MySQL) database, so this app's Neon
// Postgres database has its own name there. Standalone/Vercel keep using DATABASE_URL.
export function getSql() {
  const url = process.env.PROMPT_ENGINEERING_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('PROMPT_ENGINEERING_DATABASE_URL (or DATABASE_URL) is not set')
  return neon(url)
}
