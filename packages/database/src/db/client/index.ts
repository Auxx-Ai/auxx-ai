// packages/database/src/db/client/index.ts
// Drizzle database client singleton with optional read replicas

import { createScopedLogger } from '@auxx/logger'
import type { Logger as DrizzleLogger } from 'drizzle-orm/logger'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { type PgWithReplicas, withReplicas } from 'drizzle-orm/pg-core'
import pg, { type Pool as IPool, type PoolConfig } from 'pg'
import * as relations from '../relations'
import * as schema from '../schema'

const { Pool } = pg

/** Connection is the primary typed Drizzle client with access to the underlying pg Pool */
export type Connection = NodePgDatabase<typeof schema & typeof relations> & { $client: IPool }

/** Database is either a single primary connection or a withReplicas wrapper */
export type Database = Connection | PgWithReplicas<Connection>

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

/** Pool configuration with env-driven overrides per service */
const POOL_CONFIG: PoolConfig = {
  max: Number(process.env.DB_POOL_MAX) || 10,
  min: 0,
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT) || 30_000,
  idle_in_transaction_session_timeout: 30_000,
  statement_timeout: 30_000,
}

// ---------------------------------------------------------------------------
// Query logger — enable via DB_QUERY_LOGGING=true
// ---------------------------------------------------------------------------

/** Maximum number of characters logged for any SQL parameter to suppress large payloads. */
const MAX_SQL_PARAM_LENGTH = 256

/** List of substrings that mark a SQL parameter key as sensitive. */
const SQL_SENSITIVE_FIELD_MARKERS = ['password', 'secret', 'token', 'apikey']

/** Scoped logger dedicated to Drizzle SQL query logging. */
const drizzleQueryLogger = createScopedLogger('drizzle-query')

/** Sanitizes SQL parameter values to prevent large payloads from flooding logs. */
function sanitizeSqlParam(param: unknown): unknown {
  if (param === null || param === undefined) return param
  if (typeof param === 'string') {
    if (param.length <= MAX_SQL_PARAM_LENGTH) return param
    return `[omitted] length=${param.length}`
  }
  if (Array.isArray(param)) {
    return param.map((value) => sanitizeSqlParam(value))
  }
  if (typeof param === 'object') {
    return Object.fromEntries(
      Object.entries(param as Record<string, unknown>).map(([key, value]) => {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
        const isSensitive = SQL_SENSITIVE_FIELD_MARKERS.some((m) => normalized.includes(m))
        return [key, isSensitive ? '[redacted]' : sanitizeSqlParam(value)]
      })
    )
  }
  return param
}

/** Logger implementation for Drizzle that emits structured, sanitized SQL query logs. */
class SanitizedDrizzleLogger implements DrizzleLogger {
  logQuery(query: string, params: unknown[]): void {
    drizzleQueryLogger.debug('Executed SQL query', {
      query,
      params: params.map((param) => sanitizeSqlParam(param)),
    })
  }
}

const logger = process.env.DB_QUERY_LOGGING === 'true' ? new SanitizedDrizzleLogger() : undefined

// ---------------------------------------------------------------------------
// Connection pools
// ---------------------------------------------------------------------------

const drizzleSchema = { ...schema, ...relations }

/** Tracks all pools for graceful shutdown */
const pools: IPool[] = []

/** Creates a pg Pool with shared config, registers it for shutdown, and sets application_name. */
function createPool(connectionString: string, name: string): IPool {
  const pool = new Pool({
    ...POOL_CONFIG,
    connectionString,
    application_name: name,
  })
  pools.push(pool)
  return pool
}

/** Primary write pool initialized from DATABASE_URL.
 * Uses process.env directly because @auxx/credentials depends on @auxx/database,
 * so importing configService here would create a circular dependency. */
const writePool = createPool(process.env.DATABASE_URL, process.env.APP_NAME || 'auxx-ai')

/** Collect optional read replicas if configured */
const replicaUrls = [process.env.READ_DATABASE_URL, process.env.READ_2_DATABASE_URL].filter(
  Boolean
) as string[]

const readReplicas: Connection[] = replicaUrls.map((url, i) => {
  const pool = createPool(url, `${process.env.APP_NAME || 'auxx-ai'}-read-${i + 1}`)
  return drizzle(pool, { schema: drizzleSchema, logger }) as Connection
})

/** Primary Drizzle client bound to the write pool */
const primary = drizzle(writePool, { schema: drizzleSchema, logger }) as Connection

/**
 * database is the singleton export for all DB access
 * - If read replicas are configured, wraps primary with replica routing
 * - Else, returns the primary connection
 */
export const database: Database =
  readReplicas.length > 0
    ? withReplicas(primary, readReplicas as [Connection, ...Connection[]])
    : primary

export type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0]

/** Gracefully close all connection pools. Call during process shutdown. */
export async function closePools(): Promise<void> {
  await Promise.allSettled(pools.map((pool) => pool.end()))
}
