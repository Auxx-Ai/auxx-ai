// packages/lib/src/cache/providers/user-mail-visibility-provider.ts

import { computeUserMailVisibility } from '../../permissions/visibility/compute-user-mail-visibility'
import type { UserMailVisibility } from '../../permissions/visibility/context'
import type { CacheProvider } from '../org-cache-provider'

/**
 * Computes a user's mail-visibility context for one org (mail-permissions §3).
 * Receives "userId:orgId" as the compute ID (org-scoped user key).
 */
export const userMailVisibilityProvider: CacheProvider<UserMailVisibility> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userMailVisibility: ${compositeId}`)
    }

    return computeUserMailVisibility(userId, organizationId, db)
  },
}
