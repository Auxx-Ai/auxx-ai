// packages/database/scripts/migrate.ts
import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 👇 ensure this resolves to packages/database/drizzle
const migrationsFolder = path.join(__dirname, '..', 'drizzle')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool)

;(async () => {
  try {
    await migrate(db, { migrationsFolder })
    console.log('✅ Migrations applied')
  } finally {
    await pool.end()
  }
})()
