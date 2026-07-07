// packages/lib/src/field-hooks/pre/inbox-personal-guard.ts

import { getCachedUserMailVisibility } from '../../cache'
import { ForbiddenError } from '../../errors'
import type { FieldPreHookHandler } from '../types'

/**
 * The field-write wall for `inbox_is_personal` / `inbox_owner_user_id`
 * (mail-permissions §11). These two fields decide whether admins are capped
 * at activity-only and whether automation can see the inbox — letting any
 * member flip them via the generic records path (form edits, Kopilot record
 * tools, workflow CRUD) would let a member hide an org inbox or expose a
 * personal one.
 *
 * - System paths without a user (the personal connect provisioning branch,
 *   workers) pass through — that is how the fields get stamped.
 * - User-initiated writes are org-admin only (the claim action clears them;
 *   an admin re-marking an inbox personal is detectable and reversible by
 *   the other admins, per the plan's risk register).
 */
export const guardInboxPersonalFields: FieldPreHookHandler = async (event) => {
  if (!event.userId) return event.newValue

  const vis = await getCachedUserMailVisibility(event.userId, event.organizationId)
  if (!vis.isAdmin) {
    throw new ForbiddenError('Only org admins can change personal-inbox ownership')
  }

  return event.newValue
}
