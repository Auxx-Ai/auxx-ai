// packages/lib/src/health/indicators/database.ts

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { HealthStateManager } from '../state-manager'
import { HEALTH_ERROR_MESSAGES, HealthStatus } from '../types'

const stateManager = new HealthStateManager()

/**
 * Check PostgreSQL health by running diagnostic queries in parallel.
 */
export async function checkDatabase(db: Database) {
  try {
    const [
      version,
      connections,
      maxConn,
      uptime,
      dbSize,
      tables,
      cacheHit,
      deadlocks,
      slowQueries,
    ] = await Promise.all([
      db.execute(sql`SELECT version()`),
      db.execute(sql`SELECT count(*)::int AS count FROM pg_stat_activity`),
      db.execute(sql`SHOW max_connections`),
      db.execute(
        sql`SELECT extract(epoch FROM current_timestamp - pg_postmaster_start_time()) AS uptime`
      ),
      db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`),
      db.execute(
        sql`SELECT schemaname, relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10`
      ),
      db.execute(
        sql`SELECT CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) = 0 THEN 0 ELSE sum(heap_blks_hit) * 100.0 / (sum(heap_blks_hit) + sum(heap_blks_read)) END AS ratio FROM pg_statio_user_tables`
      ),
      db.execute(sql`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`),
      db.execute(
        sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '1 minute'`
      ),
    ])

    const activeConns = Number(connections.rows[0]?.count ?? 0)
    const maxConns = Number(maxConn.rows[0]?.max_connections ?? 100)

    const details = {
      system: {
        timestamp: new Date().toISOString(),
        version: String(version.rows[0]?.version ?? 'Unknown'),
        uptime: formatUptime(Number(uptime.rows[0]?.uptime ?? 0)),
      },
      connections: {
        active: activeConns,
        max: maxConns,
        utilizationPercent: Math.round((activeConns / maxConns) * 100),
      },
      databaseSize: String(dbSize.rows[0]?.size ?? 'Unknown'),
      performance: {
        cacheHitRatio: `${Math.round(Number(cacheHit.rows[0]?.ratio ?? 0))}%`,
        deadlocks: Number(deadlocks.rows[0]?.deadlocks ?? 0),
        slowQueries: Number(slowQueries.rows[0]?.count ?? 0),
      },
      top10Tables: Array.from(tables.rows),
    }

    stateManager.updateState(details)
    return { status: HealthStatus.OPERATIONAL, details }
  } catch {
    return {
      status: HealthStatus.OUTAGE,
      details: {
        error: HEALTH_ERROR_MESSAGES.DATABASE_CONNECTION_FAILED,
        stateHistory: stateManager.getStateWithAge(),
      },
    }
  }
}

/** Format seconds into human-readable uptime string */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  if (hours < 24) return `${hours} hours`
  const days = Math.floor(hours / 24)
  return `${days} days`
}
