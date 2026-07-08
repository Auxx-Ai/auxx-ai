// packages/lib/src/cache/aggregate-cache-service.ts

import { BaseCacheService } from './base-cache-service'

/** Pure-TTL freshness bound for aggregate results — no write invalidation. */
const AGGREGATE_CACHE_TTL = 60 // seconds

/** Cached envelope. `computedAt` unblocks a later "updated Ns ago" affordance. */
export interface CachedAggregate<T> {
  result: T
  computedAt: number
}

/**
 * Short-TTL result cache for the aggregate engine (dashboard chart/KPI data).
 *
 * Keys embed the orgId (`agg:{orgId}:{queryHash}` — see
 * `resources/aggregate/cache-key.ts`), so a per-org escape-hatch flush is a
 * pattern invalidation; no tag sets are maintained. Pure TTL by design:
 * dashboards tolerate ~a minute of staleness, and FieldValue writes are far
 * too frequent to invalidate on.
 */
export class AggregateCacheService extends BaseCacheService {
  constructor() {
    super('agg', AGGREGATE_CACHE_TTL)
  }

  async read<T>(key: string): Promise<CachedAggregate<T> | null> {
    return this.get<CachedAggregate<T>>(key)
  }

  async write<T>(key: string, result: T): Promise<void> {
    await this.set<CachedAggregate<T>>(key, { result, computedAt: Date.now() })
  }

  /** Escape hatch: drop every cached aggregate for one org. */
  async flushOrganization(organizationId: string): Promise<void> {
    await this.invalidateByPattern(new RegExp(`^agg:${organizationId}:`))
  }
}
