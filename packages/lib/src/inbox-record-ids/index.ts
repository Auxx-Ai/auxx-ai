// packages/lib/src/inbox-record-ids/index.ts

import { type RecordId, toRecordId } from '@auxx/types/resource'
import { type InboxDef, isInboxDef } from '../resource-access/mail-sharing-defs'

/**
 * Minting correct RecordIds for inbox instances across BOTH mailbox
 * definitions (plan 40 §3 / 40a §5.1).
 *
 * A mailbox lives on `inbox` (org-shared) or, once data migration 060 has run,
 * on `personal_inbox`. Anything that turns a bare `Thread.inboxId` /
 * `Inbox.id` into a RecordId therefore has to ASK which definition owns that
 * instance — a hard-coded `toRecordId('inbox', id)` mints an id whose def no
 * longer owns the row, and every downstream consumer that matches on the def
 * (`ResourceAccess.entityDefinitionId`, the FE inbox map, field-value reads)
 * silently misses.
 *
 * **Never derive the def from `isPersonal`.** The two disagree for the entire
 * 059 → 060 window BY DESIGN: `isPersonal` is already true for legacy
 * marker-flagged mailboxes that are still on the `inbox` def. A marker-derived
 * lookup passes today's tests and breaks the moment it deploys.
 * `entityDefinitionKey` is the merged `inboxes` org-cache list's def
 * discriminator, added for exactly this (`inboxes/types.ts`).
 *
 * Cache-first by the repo's org-cache rule: one `org:inboxes` read serves a
 * whole batch, so the hottest paths (ingest publish, thread list) never take a
 * per-row DB lookup. Unknown ids fall back to `'inbox'`, which is the
 * pre-split answer for every input and fails CLOSED for a personal mailbox —
 * its re-keyed grant rows simply don't match, so it denies rather than leaks.
 *
 * This module is a LEAF on purpose: its only static dependencies are
 * `@auxx/types/resource` and the dependency-free `mail-sharing-defs`. The org
 * cache is reached through a lazy `await import('../cache')` — the barrel
 * re-exports the workflow-app cache queries and so drags the workflow engine
 * into any static importer's module graph. `ingest/inbox-meta.ts` and
 * `thread-mutation.service` already lazy-import it for exactly this reason, and
 * `store-message` — the hottest path in the system — is a static importer of
 * THIS module. Keep the dynamic import.
 *
 * NOTE (consolidation, RECON §13): `mail-sharing-guard`'s private
 * `inboxAccessRecordId` and `InboxService.recordIdForInstance` answer the same
 * question — the guard cache-first, the service via a DB read. Both should
 * collapse onto {@link resolveInboxDefKey} once those modules are free; this is
 * the intended single home.
 */

export type { InboxDef }

/**
 * `inboxId → def slug` for every mailbox in the org, from the merged `inboxes`
 * org cache. Build this ONCE per batch and read it with {@link inboxDefKeyOf};
 * do not call {@link resolveInboxDefKey} per row.
 */
export async function loadInboxDefKeys(organizationId: string): Promise<Map<string, InboxDef>> {
  const { getOrgCache } = await import('../cache')
  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const defKeys = new Map<string, InboxDef>()
  for (const inbox of inboxes) {
    // Guarded rather than trusted: the cached entry is typed `InboxDef`, but a
    // mocked or hand-built cache row must not be able to mint a RecordId with
    // `undefined` as its definition prefix.
    if (inbox.entityDefinitionKey && isInboxDef(inbox.entityDefinitionKey)) {
      defKeys.set(inbox.id, inbox.entityDefinitionKey)
    }
  }
  return defKeys
}

/** Read a def slug out of {@link loadInboxDefKeys}; `'inbox'` when unknown. */
export function inboxDefKeyOf(
  defKeys: ReadonlyMap<string, InboxDef>,
  inboxId: string | null | undefined
): InboxDef {
  return (inboxId && defKeys.get(inboxId)) || 'inbox'
}

/** The definition a single inbox instance lives on. */
export async function resolveInboxDefKey(
  organizationId: string,
  inboxId: string
): Promise<InboxDef> {
  return inboxDefKeyOf(await loadInboxDefKeys(organizationId), inboxId)
}

/**
 * Canonical SLUG-keyed RecordId for a bare inbox instance id — the keyspace
 * `ResourceAccess` mail rows and the realtime payloads use.
 */
export async function toInboxRecordId(organizationId: string, inboxId: string): Promise<RecordId> {
  return toRecordId(await resolveInboxDefKey(organizationId, inboxId), inboxId)
}
