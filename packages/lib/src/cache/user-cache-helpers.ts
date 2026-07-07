// packages/lib/src/cache/user-cache-helpers.ts

import type { UserMailVisibility } from '../permissions/visibility/context'
import { getUserCache } from './singletons'

/**
 * Get a user's cached mail-visibility context for an org (mail-permissions §3)
 * — the single input every mail read path evaluates against. Recomputed only
 * on grant / member / group / inbox changes.
 */
export async function getCachedUserMailVisibility(
  userId: string,
  orgId: string
): Promise<UserMailVisibility> {
  return getUserCache().get(userId, 'userMailVisibility', orgId)
}
