// packages/lib/src/postings/release-claims.ts

/** Free everything a journal claims, so deleting that journal leaves no orphans. */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'

/** What {@link releaseAccountingClaims} removed, for a script to print. */
export interface ReleasedAccountingClaims {
  effects: number
  deliveries: number
  reopened: number
}

/**
 * Drop the effects, deliveries and coverage a set of journals holds, and put the
 * work behind them back to `pending`.
 *
 * 🛑 **Call this BEFORE deleting the `GlPosting` rows.** Every one of those FKs
 * is `ON DELETE NO ACTION`, so the posting delete is blocked while a claim
 * stands — and a claim removed WITHOUT reopening its work strands that work on
 * `accepted` forever: `readUnpostedShipments` keys eligibility on the absence of
 * an effect and keeps offering the source, while the acceptance keys on
 * `state ∈ {pending, blocked}` and keeps refusing it. That mismatch is what made
 * a whole month report "already posted" against an empty ledger.
 *
 * ⚠️ A correction work whose `correctsEffectId` points into this set, and whose
 * own journal is NOT in it, still blocks the delete. That is deliberate: the
 * correction is real bookkeeping and a reset should say so rather than guess.
 */
export async function releaseAccountingClaims(
  db: Database | Transaction,
  organizationId: string,
  glPostingIds: readonly string[]
): Promise<ReleasedAccountingClaims> {
  const empty = { effects: 0, deliveries: 0, reopened: 0 }
  if (!glPostingIds.length) return empty
  const postingIds = [...new Set(glPostingIds)]

  const deliveries = await db
    .select({ id: schema.AccountingDelivery.id })
    .from(schema.AccountingDelivery)
    .where(
      and(
        eq(schema.AccountingDelivery.organizationId, organizationId),
        inArray(schema.AccountingDelivery.glPostingId, postingIds)
      )
    )
  const deliveryIds = deliveries.map((row) => row.id)
  if (deliveryIds.length) {
    for (const table of [
      schema.AccountingDeliveryCoverage,
      schema.AccountingDeliveryOperation,
    ] as const)
      await db
        .delete(table)
        .where(
          and(eq(table.organizationId, organizationId), inArray(table.deliveryId, deliveryIds))
        )
    await db
      .delete(schema.AccountingDelivery)
      .where(
        and(
          eq(schema.AccountingDelivery.organizationId, organizationId),
          inArray(schema.AccountingDelivery.id, deliveryIds)
        )
      )
  }

  const released = await db
    .delete(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        inArray(schema.AccountingEffect.glPostingId, postingIds)
      )
    )
    .returning({ workId: schema.AccountingEffect.workId })
  const workIds = [...new Set(released.map((row) => row.workId))]
  if (!workIds.length)
    return { effects: released.length, deliveries: deliveryIds.length, reopened: 0 }

  const reopened = await db
    .update(schema.AccountingWork)
    .set({ state: 'pending', blockedReason: null, nextAttemptAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        inArray(schema.AccountingWork.id, workIds),
        eq(schema.AccountingWork.state, 'accepted')
      )
    )
    .returning({ id: schema.AccountingWork.id })
  return {
    effects: released.length,
    deliveries: deliveryIds.length,
    reopened: reopened.length,
  }
}

/**
 * Put `accepted` work that nothing claims back to `pending`, org-wide.
 *
 * The repair for orphans a posting delete already left behind — a delete that
 * ran before {@link releaseAccountingClaims} existed, or raw SQL. Capture
 * self-heals one source at a time; this is the sweep.
 */
export async function reopenUnclaimedAcceptedWork(
  db: Database | Transaction,
  organizationId: string
): Promise<string[]> {
  const stranded = await db
    .select({ id: schema.AccountingWork.id })
    .from(schema.AccountingWork)
    .leftJoin(
      schema.AccountingEffect,
      and(
        eq(schema.AccountingEffect.organizationId, schema.AccountingWork.organizationId),
        eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
      )
    )
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.state, 'accepted'),
        isNull(schema.AccountingEffect.id)
      )
    )
  const ids = stranded.map((row) => row.id)
  if (!ids.length) return []
  const reopened = await db
    .update(schema.AccountingWork)
    .set({ state: 'pending', blockedReason: null, nextAttemptAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        inArray(schema.AccountingWork.id, ids),
        eq(schema.AccountingWork.state, 'accepted')
      )
    )
    .returning({ id: schema.AccountingWork.id })
  return reopened.map((row) => row.id)
}
