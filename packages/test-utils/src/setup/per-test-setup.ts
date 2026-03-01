// packages/test-utils/src/setup/per-test-setup.ts
// Runs in each test worker thread: creates a DB connection and handles cleanup

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, afterEach, beforeAll } from 'vitest'
import * as relations from '../../../database/src/db/relations'
import * as schema from '../../../database/src/db/schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env for the test worker
dotenv.config({ path: path.resolve(__dirname, '../../../../.env.test'), override: true })
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), override: false })
}

const drizzleSchema = { ...schema, ...relations }

// Each test worker gets its own connection pool
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  min: 0,
  idleTimeoutMillis: 10_000,
})

type TestDatabase = NodePgDatabase<typeof drizzleSchema> & { $client: pg.Pool }

const db = drizzle(pool, { schema: drizzleSchema }) as TestDatabase

// Expose the test DB globally so tests can import it from @auxx/test-utils
globalThis.__testDb = db
globalThis.__testPool = pool

// Cache table names for truncation
let tableNames: string[] = []

beforeAll(async () => {
  // Discover all user tables in public schema
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  )
  tableNames = result.rows.map((r) => r.tablename)
})

afterEach(async () => {
  // Truncate all tables between tests for isolation
  if (tableNames.length === 0) return

  const quoted = tableNames.map((t) => `"${t}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE TABLE ${quoted} CASCADE`))
})

afterAll(async () => {
  await pool.end()
})
