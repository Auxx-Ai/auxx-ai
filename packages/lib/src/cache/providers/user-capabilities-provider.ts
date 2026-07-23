// packages/lib/src/cache/providers/user-capabilities-provider.ts

import type { UserCapabilities } from '../../permissions/capabilities/compose-user-capabilities'
import { computeUserCapabilities } from '../../permissions/capabilities/compute-user-capabilities'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes a member's Layer-2 capability set for one org (§5.2).
 * Receives "userId:orgId" as the compute ID (org-scoped user key).
 */
export const userCapabilitiesProvider: CacheProvider<UserCapabilities> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userCapabilities: ${compositeId}`)
    }

    return computeUserCapabilities(userId, organizationId, db)
  },
}
