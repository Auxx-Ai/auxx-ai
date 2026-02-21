// packages/lib/src/health/indicators/redis.ts

import { getRedisClient, isRedisAvailable } from '@auxx/redis'
import { HealthStateManager } from '../state-manager'
import { HEALTH_ERROR_MESSAGES, HealthStatus } from '../types'

const stateManager = new HealthStateManager()

/**
 * Check Redis health by running INFO commands.
 * Falls back to a simple PING check if INFO returns empty (e.g. Upstash REST).
 */
export async function checkRedis() {
  try {
    const available = await isRedisAvailable()
    if (!available) {
      return {
        status: HealthStatus.OUTAGE,
        details: {
          error: HEALTH_ERROR_MESSAGES.REDIS_CONNECTION_FAILED,
          stateHistory: stateManager.getStateWithAge(),
        },
      }
    }

    const redis = await getRedisClient()
    if (!redis) {
      return {
        status: HealthStatus.OUTAGE,
        details: {
          error: HEALTH_ERROR_MESSAGES.REDIS_CONNECTION_FAILED,
          stateHistory: stateManager.getStateWithAge(),
        },
      }
    }

    // Try INFO commands — returns empty string on providers that don't support it
    const infoResult = await redis.info()
    if (infoResult) {
      return await checkRedisWithInfo(redis)
    }

    // Fallback: simple PING check
    await redis.ping()
    const details = {
      system: {
        timestamp: new Date().toISOString(),
        version: 'Unknown (INFO not available)',
        uptime: 'Unknown',
      },
      note: 'Detailed metrics unavailable — Redis provider does not support INFO command',
    }

    stateManager.updateState(details)
    return { status: HealthStatus.OPERATIONAL, details }
  } catch {
    return {
      status: HealthStatus.OUTAGE,
      details: {
        error: HEALTH_ERROR_MESSAGES.REDIS_CONNECTION_FAILED,
        stateHistory: stateManager.getStateWithAge(),
      },
    }
  }
}

/** Full health check using Redis INFO commands */
async function checkRedisWithInfo(redis: { info: (section?: string) => Promise<string> }) {
  const [info, memory, clients, stats] = await Promise.all([
    redis.info(),
    redis.info('memory'),
    redis.info('clients'),
    redis.info('stats'),
  ])

  const parsed = {
    general: parseRedisInfo(info),
    memory: parseRedisInfo(memory),
    clients: parseRedisInfo(clients),
    stats: parseRedisInfo(stats),
  }

  const hits = parseInt(parsed.stats.keyspace_hits || '0', 10)
  const misses = parseInt(parsed.stats.keyspace_misses || '0', 10)
  const hitRate = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) + '%' : '0%'

  const details = {
    system: {
      timestamp: new Date().toISOString(),
      version: parsed.general.redis_version ?? 'Unknown',
      uptime: formatUptime(Number(parsed.general.uptime_in_seconds ?? 0)),
    },
    memory: {
      used: parsed.memory.used_memory_human ?? 'Unknown',
      peak: parsed.memory.used_memory_peak_human ?? 'Unknown',
      fragmentation: Number(parsed.memory.mem_fragmentation_ratio ?? 0),
    },
    connections: {
      current: Number(parsed.clients.connected_clients ?? 0),
      total: Number(parsed.stats.total_connections_received ?? 0),
      rejected: Number(parsed.stats.rejected_connections ?? 0),
    },
    performance: {
      opsPerSecond: Number(parsed.stats.instantaneous_ops_per_sec ?? 0),
      hitRate,
      evictedKeys: Number(parsed.stats.evicted_keys ?? 0),
      expiredKeys: Number(parsed.stats.expired_keys ?? 0),
    },
    replication: {
      role: parsed.general.role ?? 'unknown',
      connectedSlaves: Number(parsed.general.connected_slaves ?? 0),
    },
  }

  stateManager.updateState(details)
  return { status: HealthStatus.OPERATIONAL, details }
}

/** Parse Redis INFO multi-line string into key-value map */
function parseRedisInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split('\r\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      result[line.slice(0, idx)] = line.slice(idx + 1)
    }
  }
  return result
}

/** Format seconds into human-readable uptime string */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  if (hours < 24) return `${hours} hours`
  return `${Math.floor(hours / 24)} days`
}
