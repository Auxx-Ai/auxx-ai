// packages/lib/src/cache/providers/user-instance-grants-provider.ts

import { computeUserInstanceGrants } from '../../permissions/visibility/compute-user-instance-grants'
import type { UserInstanceGrants } from '../../permissions/visibility/context'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes a user's instance-grant context for one org (plan v3/03 §4).
 * Receives "userId:orgId" as the compute ID (org-scoped user key).
 */
export const userInstanceGrantsProvider: CacheProvider<UserInstanceGrants> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userInstanceGrants: ${compositeId}`)
    }

    return computeUserInstanceGrants(userId, organizationId, db)
  },
}
