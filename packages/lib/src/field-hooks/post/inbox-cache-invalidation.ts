// packages/lib/src/field-hooks/post/inbox-cache-invalidation.ts

import type { EntityFieldChangeHandler } from '../types'

/**
 * Inbox fields whose value feeds every member's cached `userInstanceGrants`
 * (mail-permissions §7.1) — changing one recomputes ALL members' contexts.
 *
 * ## One entry left, after plan 40 phase 4
 *
 * `inbox_default_lens` and `inbox_is_personal` were removed here together with
 * the fields themselves (registry + entity migration 062). A set entry only ever
 * mattered because the generic records path (form edits, Kopilot record tools,
 * workflow CRUD, SDK) could WRITE the attribute and this hook is the sole cache
 * event those writers fire; with no field there is no write and no event.
 *
 * What replaced each trigger:
 *
 *  - **the floor** is a `role:org_member` `ResourceAccess` row (plan 40 §6), and
 *    `setInboxFloor` fires `resource-access.changed` + `inbox.updated` itself.
 *  - **personal-ness** is `personal_inbox` def membership (40a §3), and **def
 *    membership cannot change through a field write** — so the recompute trigger
 *    moved to record create / delete / cross-def move.
 *
 * Coverage re-verified against `cache/invalidation-graph.ts` (2026-07-29), every
 * one a `broadcastUserKeys: true` event, which is what makes EVERY member's
 * `userInstanceGrants` recompute rather than just the actor's:
 *
 *  - create → `InboxService.createInbox` fires `inbox.created`
 *  - claim (`personal_inbox` → `inbox`) → `setInboxFloor` fires
 *    `resource-access.changed` + `inbox.updated`, then `updateInbox` fires
 *    `inbox.updated` again after the owner is cleared
 *  - delete → `InboxService.deleteInbox` fires `inbox.deleted`
 *  - member offboarding → `disconnectPersonalChannelsForUser` fires
 *    `channel.disconnected` (no def change, but the channels stop syncing)
 *
 * `inbox.created` / `inbox.updated` / `inbox.deleted` each map to
 * `{ org: ['inboxes'], user: ['userInstanceGrants'] }`, and
 * `resource-access.changed` to `{ user: ['userInstanceGrants'], org:
 * ['mailGrantIndex'] }`.
 *
 * `inbox_owner_user_id` stays: it is a real field on both defs, still writable
 * through the generic path (behind `guardInboxOwnerField`), and still an input
 * to the composed context — it decides which personal mailbox is "yours" and so
 * who escapes the mail-admin `metadata` cap.
 */
const VISIBILITY_ATTRIBUTES = new Set<string>(['inbox_owner_user_id'])

/**
 * Post-write hook for ANY inbox field change (§7.1). Inboxes have two write
 * paths — `InboxService` (emits its own cache events) and the generic
 * unified-handler path (form edits, Kopilot record tools, workflow CRUD,
 * SDK), which historically emitted none: a form rename left `org:inboxes`
 * stale until TTL. This hook is the choke point both share.
 *
 * - Every inbox field write → `inbox.updated` (recomputes the cached
 *   `inboxes` shape).
 * - A {@link VISIBILITY_ATTRIBUTES} write additionally broadcasts so every
 *   member's `userInstanceGrants` recomputes (and counts go stale via the §10.1
 *   wiring in `onCacheEvent`).
 */
export const invalidateInboxCacheOnFieldChange: EntityFieldChangeHandler = async (event) => {
  const systemAttribute = (event.field as { systemAttribute?: string }).systemAttribute
  const { onCacheEvent } = await import('../../cache')
  await onCacheEvent('inbox.updated', {
    orgId: event.organizationId,
    broadcastUserKeys: systemAttribute ? VISIBILITY_ATTRIBUTES.has(systemAttribute) : false,
  })
}
