// packages/lib/src/cache/providers/subpart-edges-provider.ts

import type { SubpartRow } from '../../inventory/costing/cost-calculator'
import type { CacheProvider } from '../org-cache-provider'

/** Every live subpart edge of an org (plans/mrp/08-implementation-plan.md D42). */
export const subpartEdgesProvider: CacheProvider<SubpartRow[]> = {
  async compute(orgId, db) {
    // Lazy: the costing module imports the cache barrel.
    const { loadOrgSubpartEdges } = await import('../../inventory/costing/cost-calculator')
    return loadOrgSubpartEdges(db, orgId)
  },
}
