// packages/lib/src/cache/providers/user-table-views-provider.ts

import { computeUserTableViews } from '../../table-views/table-view-queries'
import type { CacheProvider } from '../org-cache-provider'
import type { CachedTableView } from '../user-cache-keys'

/** Computes table views for a user in a specific org. Receives "userId:orgId" as the compute ID. */
export const userTableViewsProvider: CacheProvider<CachedTableView[]> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userTableViews: ${compositeId}`)
    }

    return computeUserTableViews(userId, organizationId, db)
  },
}
