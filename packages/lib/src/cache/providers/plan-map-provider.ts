// packages/lib/src/cache/providers/plan-map-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CachedPlan } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'
import { serializePlan } from './plans-provider'

/** Computes all non-legacy plans indexed by ID */
export const planMapProvider: AppCacheProvider<Record<string, CachedPlan>> = {
  async compute(db) {
    const plans = await db.select().from(schema.Plan).where(eq(schema.Plan.isLegacy, false))

    const map: Record<string, CachedPlan> = {}
    for (const p of plans) {
      map[p.id] = serializePlan(p)
    }
    return map
  },
}
