// packages/database/lambda/deploy.ts

import { Resource } from 'sst'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import path from 'node:path'
import fs from 'node:fs/promises'

/** Global headers reused across Lambda responses. */
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
}

/** Absolute path to the bundled Drizzle SQL migrations folder. */
const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle')

/** Supported values for the optional SSL mode override. */
type SslMode = 'disable' | 'require'

/** Shape of the Lambda invocation payload returned to the caller. */
type LambdaResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
}

/**
 * Assemble a PostgreSQL connection string from the linked RDS resource. and more
 */
const createDatabaseUrl = (): string => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  const rds = Resource.AuxxAiRds

  if (!rds || !rds.host || !rds.username || !rds.password || !rds.database) {
    throw new Error('RDS connection details are missing from the linked resource.')
  }

  return `postgresql://${rds.username}:${rds.password}@${rds.host}:${rds.port || 5432}/${rds.database}`
}

/**
 * Convert the Lambda environment configuration into a pg Pool instance.
 */
const createPool = (databaseUrl: string): Pool => {
  const sslMode = (process.env.DB_SSL_MODE as SslMode | undefined) || 'disable'
  const idleTimeoutMillis = Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10)
  const connectionTimeoutMillis = Number.parseInt(
    process.env.DB_POOL_CONNECTION_TIMEOUT || '2000',
    10
  )

  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    min: 1,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : false,
    application_name: 'auxx-ai-deploy',
  })
}

/**
 * Ensure the migrations directory exists in the Lambda bundle before attempting to run them.
 */
const assertMigrationsPresent = async () => {
  const stats = await fs.stat(MIGRATIONS_DIR).catch(() => undefined)
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Missing Drizzle migrations in bundle at ${MIGRATIONS_DIR}`)
  }
}

/**
 * Execute Drizzle migrations against the linked RDS instance.
 */
export const handler = async (): Promise<LambdaResponse> => {
  try {
    await assertMigrationsPresent()

    const databaseUrl = createDatabaseUrl()
    const pool = createPool(databaseUrl)

    try {
      const db = drizzle(pool)
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR })

      return {
        statusCode: 200,
        headers: DEFAULT_HEADERS,
        body: JSON.stringify({
          success: true,
          message: 'Drizzle migrations completed successfully',
          stage: process.env.SST_STAGE,
          timestamp: new Date().toISOString(),
        }),
      }
    } finally {
      await pool.end()
    }
  } catch (error) {
    console.error('❌ Drizzle migration deploy failed', error)

    return {
      statusCode: 500,
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown migration failure',
      }),
    }
  }
}

export default handler
