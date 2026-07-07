// packages/lib/src/field-hooks/post/inbox-cache-invalidation.ts

import type { EntityFieldChangeHandler } from '../types'

/**
 * Inbox fields whose value feeds every member's cached `userMailVisibility`
 * (mail-permissions §7.1) — changing one recomputes ALL members' contexts.
 */
const VISIBILITY_ATTRIBUTES = new Set<string>([
  'inbox_default_lens',
  'inbox_is_personal',
  'inbox_owner_user_id',
])

/**
 * Post-write hook for ANY inbox field change (§7.1). Inboxes have two write
 * paths — `InboxService` (emits its own cache events) and the generic
 * unified-handler path (form edits, Kopilot record tools, workflow CRUD,
 * SDK), which historically emitted none: a form rename left `org:inboxes`
 * stale until TTL. This hook is the choke point both share.
 *
 * - Every inbox field write → `inbox.updated` (recomputes the cached
 *   `inboxes` shape).
 * - Lens/personal fields additionally broadcast so every member's
 *   `userMailVisibility` recomputes (and counts go stale via the §10.1
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
