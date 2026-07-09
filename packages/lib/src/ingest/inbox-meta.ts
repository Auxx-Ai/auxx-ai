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
