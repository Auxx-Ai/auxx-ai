// packages/lib/src/postings/release-claims.ts

/** Free everything a journal claims, so deleting that journal leaves no orphans. */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { ConflictError } from '../errors'

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
 * Release one reversed posting's claim: its effect and coverage go, the work
 * behind it reopens on a bumped basis version, and the delivery is kept only
 * if the provider actually holds a copy (brief 62 R2-R4).
 *
 * 🛑 **R5.** If a correction already names one of this posting's effects as
 * `correctsEffectId`, this refuses instead of deleting under it - the
 * correction is real bookkeeping and the reversal should say so.
 *
 * Unlike {@link releaseAccountingClaims}, a delivery the provider holds a copy
 * of is kept rather than dropped: `unsync` R4 reads it to withdraw the pair,
 * and the coverage rows are removed regardless because their FK to the effect
 * is `NO ACTION`.
 */
export async function releaseReversedPostingClaimsInTx(
  tx: Transaction,
  organizationId: string,
  original: { id: string; docNumber: string; exportStatus: string }
): Promise<ReleasedAccountingClaims> {
  const empty = { effects: 0, deliveries: 0, reopened: 0 }
  const effects = await tx
    .select({ id: schema.AccountingEffect.id, workId: schema.AccountingEffect.workId })
    .from(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingEffect.glPostingId, original.id)
      )
    )
  if (!effects.length) return empty
  const effectIds = effects.map((effect) => effect.id)

  const [corrected] = await tx
    .select({ id: schema.AccountingWork.id })
    .from(schema.AccountingWork)
    .where(
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        inArray(schema.AccountingWork.correctsEffectId, effectIds)
      )
    )
    .limit(1)
  if (corrected)
    throw new ConflictError(
      `${original.docNumber} has been corrected; a corrected entry cannot be reversed`
    )

  // The coverage's FK to the effect is NO ACTION, so it must go before the effect.
  await tx
    .delete(schema.AccountingDeliveryCoverage)
    .where(
      and(
        eq(schema.AccountingDeliveryCoverage.organizationId, organizationId),
        inArray(schema.AccountingDeliveryCoverage.effectId, effectIds)
      )
    )

  const deliveries = await tx
    .select({ id: schema.AccountingDelivery.id })
    .from(schema.AccountingDelivery)
    .where(
      and(
        eq(schema.AccountingDelivery.organizationId, organizationId),
        eq(schema.AccountingDelivery.glPostingId, original.id)
      )
    )
  const deliveryIds = deliveries.map((row) => row.id)

  // R4: both halves or neither. A delivery the provider never received is
  // dropped rather than kept as a plan for a copy that is never coming.
  let providerHoldsCopy = original.exportStatus === 'exported'
  if (!providerHoldsCopy && deliveryIds.length) {
    const operations = await tx
      .select({ id: schema.AccountingDeliveryOperation.id })
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          inArray(schema.AccountingDeliveryOperation.deliveryId, deliveryIds)
        )
      )
    const operationIds = operations.map((row) => row.id)
    if (operationIds.length) {
      const [remoteObject] = await tx
        .select({ id: schema.ExternalAccountingObject.id })
        .from(schema.ExternalAccountingObject)
        .where(
          and(
            eq(schema.ExternalAccountingObject.organizationId, organizationId),
            inArray(schema.ExternalAccountingObject.operationId, operationIds)
          )
        )
        .limit(1)
      providerHoldsCopy = !!remoteObject
    }
  }

  if (!providerHoldsCopy && deliveryIds.length) {
    await tx
      .delete(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          inArray(schema.AccountingDeliveryOperation.deliveryId, deliveryIds)
        )
      )
    await tx
      .delete(schema.AccountingDelivery)
      .where(
        and(
          eq(schema.AccountingDelivery.organizationId, organizationId),
          inArray(schema.AccountingDelivery.id, deliveryIds)
        )
      )
    // Nothing is owed for a reversed row that never reached the provider.
    await tx
      .update(schema.GlPosting)
      .set({ exportStatus: 'not_required' })
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.id, original.id)
        )
      )
  }

  const released = await tx
    .delete(schema.AccountingEffect)
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        inArray(schema.AccountingEffect.id, effectIds)
      )
    )
    .returning({ workId: schema.AccountingEffect.workId })
  const workIds = [...new Set(released.map((row) => row.workId))]

  for (const workId of workIds) {
    const [work] = await tx
      .select()
      .from(schema.AccountingWork)
      .where(
        and(
          eq(schema.AccountingWork.organizationId, organizationId),
          eq(schema.AccountingWork.id, workId)
        )
      )
      .for('update')
    if (!work) continue
    const [basis] = await tx
      .select()
      .from(schema.AccountingWorkBasis)
      .where(
        and(
          eq(schema.AccountingWorkBasis.organizationId, organizationId),
          eq(schema.AccountingWorkBasis.workId, workId),
          eq(schema.AccountingWorkBasis.version, work.basisVersion)
        )
      )
      .limit(1)
    if (!basis) continue
    // The acceptance membership hash - and so the claim key - includes
    // `basisVersion`; without the bump a re-post of the same membership
    // collides with the reversed row's revision-0 claim.
    await tx.insert(schema.AccountingWorkBasis).values({
      organizationId,
      workId,
      version: work.basisVersion + 1,
      sourceHash: basis.sourceHash,
      effectiveDate: basis.effectiveDate,
      basis: basis.basis,
    })
    await tx
      .update(schema.AccountingWork)
      .set({
        state: 'pending',
        basisVersion: work.basisVersion + 1,
        blockedReason: null,
        nextAttemptAt: null,
        leaseToken: null,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.AccountingWork.organizationId, organizationId),
          eq(schema.AccountingWork.id, workId)
        )
      )
  }

  return { effects: released.length, deliveries: deliveryIds.length, reopened: workIds.length }
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
