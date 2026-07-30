// packages/lib/src/cache/user-cache-helpers.ts

import type { UserCapabilities } from '../permissions/capabilities/compose-user-capabilities'
import type { UserInstanceGrants } from '../permissions/visibility/context'
import { getUserCache } from './singletons'

/**
 * Get a user's cached instance-grant context for an org (plan v3/03 §4)
 * — the single input every mail read path evaluates against. Recomputed only
 * on grant / member / group / inbox changes.
 */
export async function getCachedUserInstanceGrants(
  userId: string,
  orgId: string
): Promise<UserInstanceGrants> {
  return getUserCache().get(userId, 'userInstanceGrants', orgId)
}

/**
 * Get a member's cached Layer-2 capability set for an org (§5.2) — the composed
 * capability keys + type-level def-access scoping. Recomputed on grant / member /
 * seat-type / group / type-access changes.
 */
export async function getCachedUserCapabilities(
  userId: string,
  orgId: string
): Promise<UserCapabilities> {
  return getUserCache().get(userId, 'userCapabilities', orgId)
}
