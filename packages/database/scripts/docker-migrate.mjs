// packages/database/scripts/docker-migrate.mjs
// Standalone migration runner for Docker containers.
// Uses drizzle-orm + pg (production deps) — no drizzle-kit required.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.join(__dirname, '..', 'drizzle')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool)

try {
  console.log(`Running migrations from ${migrationsFolder}...`)
  await migrate(db, { migrationsFolder })
  console.log('Migrations applied successfully.')
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
} finally {
  await pool.end()
}
