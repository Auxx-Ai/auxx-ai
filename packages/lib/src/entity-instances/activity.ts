// packages/lib/src/entity-instances/activity.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache/singletons'

type DbOrTx = Database | Transaction

const logger = createScopedLogger('entity-activity')

/**
 * Resolve every active linked entity for a thread: `Thread.primaryEntityInstanceId`
 * plus active (non-unlinked) `ThreadEntityLink` secondaries. Shared by the activity
 * and interaction touches so a message-store call site resolves the set once.
 */
export async function resolveThreadLinkedEntityIds(
  threadId: string,
  organizationId: string,
  tx?: DbOrTx
): Promise<string[]> {
  const db = tx ?? database

  const [primary, secondaries] = await Promise.all([
    db
      .select({ id: schema.Thread.primaryEntityInstanceId })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: schema.ThreadEntityLink.entityInstanceId })
      .from(schema.ThreadEntityLink)
      .where(
        and(
          eq(schema.ThreadEntityLink.threadId, threadId),
          eq(schema.ThreadEntityLink.organizationId, organizationId),
          sql`${schema.ThreadEntityLink.unlinkedAt} IS NULL`
        )
      ),
  ])

  const ids = new Set<string>()
  if (primary[0]?.id) ids.add(primary[0].id)
  for (const s of secondaries) {
    if (s.id) ids.add(s.id)
  }
  return Array.from(ids)
}

/**
 * Advance `EntityInstance.lastActivityAt` for one or more entities, monotonically.
 *
 * "Monotonically" means: only writes when the new timestamp is strictly newer
 * than what's already stored. Out-of-order events (e.g. a delayed worker job
 * for an old message) cannot rewind activity.
 *
 * Caller responsibilities:
 * - Never call inside a tight loop without batching — the staleness scanner
 *   uses this column for filtering, so an unnecessary write triggers index churn.
 * - For thread-derived events (inbound message, comment), look up linked
 *   entities via Thread.primaryEntityInstanceId + ThreadEntityLink (active rows)
 *   and pass the full set in one call.
 */
export async function touchEntityActivity(
  entityInstanceIds: string[],
  organizationId: string,
  at: Date = new Date(),
  tx?: DbOrTx
): Promise<void> {
  if (entityInstanceIds.length === 0) return
  const db = tx ?? database

  try {
    await db
      .update(schema.EntityInstance)
      .set({ lastActivityAt: at })
      .where(
        and(
          inArray(schema.EntityInstance.id, entityInstanceIds),
          eq(schema.EntityInstance.organizationId, organizationId),
          // Monotonic guard — never rewind.
          or(
            sql`${schema.EntityInstance.lastActivityAt} IS NULL`,
            sql`${schema.EntityInstance.lastActivityAt} < ${at}`
          )
        )
      )
  } catch (error) {
    // Activity touch is a best-effort denormalized write. Don't break the
    // calling write path on failure.
    logger.warn('Failed to touch entity activity', {
      organizationId,
      entityInstanceIds,
      error: error instanceof Error ? error.message : error,
    })
  }
}

/**
 * Resolve every active linked entity for a thread (primary + secondaries) and
 * advance their `lastActivityAt`. Used by message / comment / thread hooks.
 */
export async function touchActivityForThreadLinks(
  threadId: string,
  organizationId: string,
  at: Date = new Date(),
  tx?: DbOrTx
): Promise<void> {
  const ids = await resolveThreadLinkedEntityIds(threadId, organizationId, tx)
  if (ids.length === 0) return
  await touchEntityActivity(ids, organizationId, at, tx)
}

/**
 * Stamp first/last interaction on entities, monotonically and order-independently:
 * first-wins (`IS NULL OR older`) / last-wins (`IS NULL OR newer`) on the message's
 * real `sentAt`. Backfill batches in any order, concurrent walkers, and live mail
 * all converge to the same values — no dependency on event/signal semantics.
 *
 * Narrower than `touchEntityActivity`: only real correspondence counts (the caller
 * decides what qualifies — hard-tier machine mail and unsent drafts never do).
 */
export async function touchEntityInteraction(
  entityInstanceIds: string[],
  organizationId: string,
  messageId: string,
  sentAt: Date,
  tx?: DbOrTx
): Promise<void> {
  if (entityInstanceIds.length === 0) return
  const db = tx ?? database

  try {
    await db
      .update(schema.EntityInstance)
      .set({ firstInteractionAt: sentAt, firstInteractionMessageId: messageId })
      .where(
        and(
          inArray(schema.EntityInstance.id, entityInstanceIds),
          eq(schema.EntityInstance.organizationId, organizationId),
          // First-wins guard — only an older message may claim "first".
          or(
            sql`${schema.EntityInstance.firstInteractionAt} IS NULL`,
            sql`${schema.EntityInstance.firstInteractionAt} > ${sentAt}`
          )
        )
      )
    await db
      .update(schema.EntityInstance)
      .set({ lastInteractionAt: sentAt, lastInteractionMessageId: messageId })
      .where(
        and(
          inArray(schema.EntityInstance.id, entityInstanceIds),
          eq(schema.EntityInstance.organizationId, organizationId),
          // Last-wins guard — never rewind.
          or(
            sql`${schema.EntityInstance.lastInteractionAt} IS NULL`,
            sql`${schema.EntityInstance.lastInteractionAt} < ${sentAt}`
          )
        )
      )
  } catch (error) {
    // Best-effort denormalized write — never fail ingest or send on it.
    logger.warn('Failed to touch entity interaction', {
      organizationId,
      entityInstanceIds,
      messageId,
      error: error instanceof Error ? error.message : error,
    })
  }
}

/**
 * Companies are usually not thread-linked, so interaction stamps propagate from
 * stamped contacts to their linked companies via the `contact_employer` field
 * (maintained by `ingest/companies/link-contact.ts`). Non-contact ids simply have
 * no employer rows and contribute nothing.
 */
async function resolveLinkedCompanyIds(
  entityInstanceIds: string[],
  organizationId: string,
  tx?: DbOrTx
): Promise<string[]> {
  if (entityInstanceIds.length === 0) return []
  const db = tx ?? database

  const { contact_employer: employerField } = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['contact_employer'])
  if (!employerField) return []

  const rows = await db
    .select({ companyId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, employerField.id),
        inArray(schema.FieldValue.entityId, entityInstanceIds),
        isNotNull(schema.FieldValue.relatedEntityId)
      )
    )

  const ids = new Set<string>()
  for (const r of rows) {
    if (r.companyId) ids.add(r.companyId)
  }
  return Array.from(ids)
}

/**
 * Stamp first/last interaction for every entity linked to a thread (primary +
 * active secondaries), plus the stamped contacts' linked companies. Call sites:
 * ingest (`store-message.ts`, qualifying messages only) and the sender
 * (`message-sender.service.ts`, successful sends with the reconciler-confirmed
 * `sentAt`) — Auxx-sent mail never reaches ingest's fresh-insert path, and the
 * sync echo early-returns before the ingest touch.
 *
 * Pass `opts.entityInstanceIds` when the caller already resolved the thread-link
 * set (e.g. for the activity touch) to avoid re-running the SELECTs.
 */
export async function touchInteractionForThreadLinks(
  threadId: string,
  organizationId: string,
  messageId: string,
  sentAt: Date,
  opts?: { entityInstanceIds?: string[]; tx?: DbOrTx }
): Promise<void> {
  try {
    const linked =
      opts?.entityInstanceIds ??
      (await resolveThreadLinkedEntityIds(threadId, organizationId, opts?.tx))
    if (linked.length === 0) return

    const companyIds = await resolveLinkedCompanyIds(linked, organizationId, opts?.tx)
    const all = Array.from(new Set([...linked, ...companyIds]))
    await touchEntityInteraction(all, organizationId, messageId, sentAt, opts?.tx)
  } catch (error) {
    // Same contract as the activity touch: log and swallow.
    logger.warn('Failed to touch interaction for thread links', {
      organizationId,
      threadId,
      messageId,
      error: error instanceof Error ? error.message : error,
    })
  }
}
