// packages/lib/src/field-hooks/pre/inbox-owner-guard.ts

import { getCachedUserInstanceGrants } from '../../cache'
import { ForbiddenError } from '../../errors'
import type { FieldPreHookHandler } from '../types'

/**
 * The field-write wall for `inbox_owner_user_id` (mail-permissions §11).
 *
 * **What this replaced.** Until plan 40 phase 4 this hook was
 * `guardInboxPersonalFields` and defended TWO fields: `inbox_is_personal` and
 * `inbox_owner_user_id`. The marker is gone — personal-ness is membership of the
 * `personal_inbox` EntityDefinition (40a §3), and a def cannot be flipped by a
 * field write, so there is nothing left for the marker half to defend. That was
 * the whole argument for the def split: the marker was forgeable through the
 * generic records path and needed a wall in front of it; def membership is
 * unforgeable and needs none.
 *
 * **Why the owner half survives.** `inbox_owner_user_id` is still real, still
 * materialized on BOTH inbox definitions (40a §1.2), and still decides
 * authorization-adjacent behaviour: whose personal mailbox this is, and
 * therefore who `personalInboxIds` exempts from the mail-admin `metadata` cap,
 * who `channels/manage-access.ts` lets manage the channel, and who ingest names
 * as the owner. Rewriting it is a way to hand yourself someone else's mailbox.
 *
 * The generic records path (form edits, Kopilot record tools, workflow CRUD,
 * SDK) is the surface this covers. It is NOT redundant with the fieldValue
 * router's `assertAdminInstance` (plan 40 §5.5): a personal mailbox's owner
 * holds the `admin` row by construction, so that gate passes for the very person
 * this wall exists to stop. Org-admin only, both defs.
 *
 * System paths without a user (the personal connect provisioning branch,
 * workers) pass through — that is how the field gets stamped in the first place.
 */
export const guardInboxOwnerField: FieldPreHookHandler = async (event) => {
  if (!event.userId) return event.newValue

  const vis = await getCachedUserInstanceGrants(event.userId, event.organizationId)
  if (!vis.isAdmin) {
    throw new ForbiddenError('Only org admins can change personal-inbox ownership')
  }

  return event.newValue
}
