// packages/test-utils/src/setup/global-setup.ts
// Runs once before all tests: connects to test DB, resets schema, runs migrations

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default async function globalSetup() {
  // 1. Load environment variables
  dotenv.config({
    path: path.resolve(__dirname, '../../../../.env.test'),
    override: true,
  })

  // Fallback to .env if .env.test doesn't set DATABASE_URL
  if (!process.env.DATABASE_URL) {
    dotenv.config({
      path: path.resolve(__dirname, '../../../../.env'),
      override: false,
    })
  }

  // 2. Safety check: ensure we're pointing at the test database
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create .env.test with:\n' +
        'DATABASE_URL=postgres://postgres:postgres@localhost:5432/auxx_test'
    )
  }
  if (!dbUrl.includes('test')) {
    throw new Error(
      `DATABASE_URL must point to a test database (got: ${dbUrl}).\n` +
        'Set DATABASE_URL=postgres://postgres:postgres@localhost:5432/auxx_test in .env.test'
    )
  }

  // 3. Drop and recreate the test database for a perfectly clean state.
  //    We connect to the default 'postgres' database to issue DROP/CREATE.
  const url = new URL(dbUrl)
  const testDbName = url.pathname.slice(1) // e.g. "auxx_test"
  url.pathname = '/postgres'
  const adminUrl = url.toString()

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 1 })
  try {
    console.log(`Resetting test database "${testDbName}"...`)

    // Terminate existing connections to the test database
    await adminPool.query(
      `
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `,
      [testDbName]
    )

    await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}"`)
    await adminPool.query(`CREATE DATABASE "${testDbName}"`)
  } finally {
    await adminPool.end()
  }

  // 4. Connect to the freshly created test database
  const pool = new pg.Pool({ connectionString: dbUrl })

  // 5. Run all Drizzle migrations
  const migrationsFolder = path.resolve(__dirname, '../../../../packages/database/drizzle')
  const db = drizzle(pool)

  console.log('Running migrations...')
  await migrate(db, { migrationsFolder })

  // 6. Store pool reference for teardown
  // @ts-expect-error -- global assignment for teardown
  globalThis.__TEST_POOL__ = pool

  console.log('Test database ready')
}
