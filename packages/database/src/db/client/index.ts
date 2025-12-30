// packages/database/src/db/client/index.ts
// Drizzle database client singleton with optional read replicas

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { withReplicas, type PgWithReplicas } from 'drizzle-orm/pg-core'
import type { Logger as DrizzleLogger } from 'drizzle-orm/logger'
import pg, { type Pool as IPool, type PoolConfig } from 'pg'
import * as schema from '../schema'
import * as relations from '../relations'
import { env } from '@auxx/config'
import { createScopedLogger } from '@auxx/logger'

const { Pool } = pg

/** Connection is the primary typed Drizzle client with access to the underlying pg Pool */
export type Connection = NodePgDatabase<typeof schema & typeof relations> & { $client: IPool }

/** Database is either a single primary connection or a withReplicas wrapper */
export type Database = Connection | PgWithReplicas<Connection>

/** Default pool configuration for general workloads */
const POOL_CONFIG: PoolConfig = {
  max: 10,
  min: 0,
  idleTimeoutMillis: 30_000,
  // Database-level timeouts can also be set via connection string or per-session statements
  // These properties are recognized by pg when passed via connection parameters
  idle_in_transaction_session_timeout: 30_000,
  statement_timeout: 30_000,
}

/** Maximum number of characters logged for any SQL parameter to suppress large payloads. */
const MAX_SQL_PARAM_LENGTH = 256

/** Placeholder used when a SQL parameter is skipped due to size. */
const SQL_PARAM_OMITTED_PLACEHOLDER = '[omitted]'

/** Placeholder used when a SQL parameter is redacted for sensitivity. */
const SQL_PARAM_REDACTED_PLACEHOLDER = '[redacted]'

/** List of substrings that mark a SQL parameter key as sensitive. */
const SQL_SENSITIVE_FIELD_MARKERS = ['password', 'secret', 'token', 'apikey']

/** Scoped logger dedicated to Drizzle SQL query logging. */
const drizzleQueryLogger = createScopedLogger('drizzle-query')

/**
 * Sanitizes SQL parameter values to prevent extremely large payloads from flooding logs.
 */
function sanitizeSqlParam(param: unknown): unknown {
  if (param === null || param === undefined) return param
  if (typeof param === 'string') {
    if (param.length <= MAX_SQL_PARAM_LENGTH) return param
    return `${SQL_PARAM_OMITTED_PLACEHOLDER} length=${param.length}`
  }
  if (Array.isArray(param)) {
    return param.map((value) => sanitizeSqlParam(value))
  }
  if (typeof param === 'object') {
    return Object.fromEntries(
      Object.entries(param as Record<string, unknown>).map(([key, value]) => {
        const normalized = normalizeParamKey(key)
        if (isSensitiveParamKey(normalized)) {
          return [key, SQL_PARAM_REDACTED_PLACEHOLDER]
        }
        return [key, sanitizeSqlParam(value)]
      })
    )
  }
  return param
}

/** Normalizes SQL parameter keys for comparison purposes. */
function normalizeParamKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/** Determines whether a normalized SQL parameter key should be redacted. */
function isSensitiveParamKey(normalizedKey: string): boolean {
  return SQL_SENSITIVE_FIELD_MARKERS.some((marker) => normalizedKey.includes(marker))
}

/**
 * Logger implementation for Drizzle that emits structured, sanitized SQL query logs.
 */
class SanitizedDrizzleLogger implements DrizzleLogger {
  logQuery(query: string, params: unknown[]): void {
    drizzleQueryLogger.debug('Executed SQL query', {
      query,
      params: params.map((param) => sanitizeSqlParam(param)),
    })
  }
}

/** Shared instance of the sanitized Drizzle logger. */
const sanitizedDrizzleLogger = new SanitizedDrizzleLogger()

/** Primary write pool initialized from DATABASE_URL */
const writePool = new Pool({
  ...POOL_CONFIG,
  connectionString: env.DATABASE_URL,
})

/** Collect optional read replicas if configured */
const readReplicas: Connection[] = []

if (env.READ_DATABASE_URL) {
  const read1 = new Pool({ ...POOL_CONFIG, connectionString: env.READ_DATABASE_URL })
  readReplicas.push(
    drizzle(read1, {
      schema: { ...schema, ...relations },
      // logger: sanitizedDrizzleLogger,
      logger: undefined,
    }) as Connection
  )
}

if (env.READ_2_DATABASE_URL) {
  const read2 = new Pool({ ...POOL_CONFIG, connectionString: env.READ_2_DATABASE_URL })
  readReplicas.push(
    drizzle(read2, {
      schema: { ...schema, ...relations },
      // logger: sanitizedDrizzleLogger,
      logger: undefined,
    }) as Connection
  )
}

/** Primary Drizzle client bound to the write pool */
const primary = drizzle(writePool, {
  schema: { ...schema, ...relations },
  // logger: sanitizedDrizzleLogger,
  logger: undefined,
}) as Connection

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
