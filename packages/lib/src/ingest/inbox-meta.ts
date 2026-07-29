// packages/lib/src/ingest/inbox-meta.ts

import type { IngestContext } from './context'

/** Personal-account metadata for an inbox, resolved from the org cache. */
export interface InboxMeta {
  isPersonal: boolean
  ownerUserId: string | null
}

/**
 * Resolve an inbox's personal-account metadata from the org `inboxes` cache
 * (hydrated per-org — no DB round-trip). Returns null for unknown/missing
 * inbox ids. Used at ingest time to give personal Gmail channels label-derived
 * thread status while shared inboxes keep everything-open helpdesk semantics.
 *
 * Def-agnostic on purpose (plan 40 §3.4): the `inboxes` cache is ONE merged
 * list across `inbox` + `personal_inbox` with `isPersonal` derived from def
 * membership, so this module — and everything it feeds (`store-message`'s
 * label-derived status, participant owner-naming, the Gmail archive-vs-delete
 * parity in `sync-messages` and `thread-provider-status-sync-job`) — keeps
 * working across the def move with no change. Do NOT reintroduce a
 * `inbox_is_personal` FieldValue read here; the cache is the only place that
 * derivation is allowed to live.
 */
export async function getInboxMeta(
  ctx: IngestContext,
  inboxId: string | null | undefined
): Promise<InboxMeta | null> {
  if (!inboxId) return null
  // Lazy-import the cache barrel (heavy) at call time, matching the pattern in
  // thread-mutation.service. The org cache memoizes the `inboxes` key, so this
  // is an in-memory Map lookup after the first hydrate.
  const { getOrgCache } = await import('../cache')
  const inboxes = await getOrgCache().get(ctx.organizationId, 'inboxes')
  const inbox = inboxes.find((i) => i.id === inboxId)
  if (!inbox) return null
  return { isPersonal: inbox.isPersonal, ownerUserId: inbox.ownerUserId }
}

/** Convenience predicate: is this inbox a personal account? */
export async function isPersonalInbox(
  ctx: IngestContext,
  inboxId: string | null | undefined
): Promise<boolean> {
  const meta = await getInboxMeta(ctx, inboxId)
  return meta?.isPersonal ?? false
}
