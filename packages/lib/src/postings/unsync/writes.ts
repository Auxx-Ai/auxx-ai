// packages/lib/src/postings/unsync/writes.ts
//
// Steps 2 and 5 of plans/accounting/tasks/60-un-syncing-from-the-provider.md §5.1:
// open and lease the withdrawal operation, then - only once the provider has
// confirmed the copy is gone - reset the row in one transaction.
//
// 🛑 {@link saveWithdrawal} is the ONLY writer of `GlPosting.exportStatus` in
// this module, and nothing else here touches `GlPosting` at all. That is E4
// ("delete first, reset second") expressed as a file boundary: a row that says
// held while a copy still sits in the provider is how the same entry gets
// delivered twice.
//
// 🛑 The LEDGER is never touched. No effect, no coverage, no work row, no
// period - E3. `AccountingDeliveryCoverage` survives a withdrawal unchanged:
// the delivery still owns those effects, it simply has nothing outstanding in
// the provider.

import { randomUUID } from 'node:crypto'
import { type AccountingDeliveryOperationEntity, type Database, schema } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { withAccountingCommitLock } from '../accounting-commit-lock'
import { accountingBasisHash } from '../basis-hash'

/** The withdrawal's operation key. `journal` keys the sends, `unsync:<n>` the withdrawals. */
export const unsyncOperationKey = (epoch: number) => `unsync:${epoch}`

/** Claimed with a lease, or somebody else already holds it. */
export type UnsyncClaim =
  | { kind: 'claimed'; operation: AccountingDeliveryOperationEntity; token: string }
  | { kind: 'busy' }
  | { kind: 'spent' }

/**
 * Open the withdrawal operation for this epoch and take its lease.
 *
 * Re-entrant by construction: an operation left `uncertain` by a delete of
 * unknown outcome is re-claimed here rather than duplicated, which is what lets
 * §2.4's recovery be an ordinary second press of Un-sync.
 *
 * ⚠️ A `payload` is written at insert because `AccountingDeliveryOperation`'s
 * own check constraint forbids a `firstSentAt` on a payload-less row. It carries
 * the identity of what is being removed and NOT the `SyncToken`, which is read
 * fresh on every attempt and would otherwise make the stored hash a lie the
 * moment `force` sent a different one.
 */
export async function claimUnsyncOperation(
  db: Database,
  input: {
    organizationId: string
    deliveryId: string
    operationKey: string
    leaseMs: number
    externalId: string
    docNumber: string
  }
): Promise<UnsyncClaim> {
  const { organizationId, deliveryId, operationKey } = input

  return db.transaction(async (tx): Promise<UnsyncClaim> => {
    await withAccountingCommitLock(tx, organizationId)

    let [operation] = await tx
      .select()
      .from(schema.AccountingDeliveryOperation)
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          eq(schema.AccountingDeliveryOperation.deliveryId, deliveryId),
          eq(schema.AccountingDeliveryOperation.operationKey, operationKey)
        )
      )
      .limit(1)

    if (!operation) {
      const payload = { journalEntryId: input.externalId, docNumber: input.docNumber }
      ;[operation] = await tx
        .insert(schema.AccountingDeliveryOperation)
        .values({
          organizationId,
          deliveryId,
          operationKey,
          objectType: 'journal',
          // 🛑 Fresh, never the posting's: `GlPosting.requestId` is the
          // provider's idempotence key for the CREATE, and the re-send after
          // this withdrawal needs it unspent (§2.2).
          requestId: randomUUID(),
          payload,
          payloadHash: accountingBasisHash(payload),
          state: 'pending',
        })
        .returning()
    }
    if (!operation) throw new Error('Withdrawal operation creation returned no row')
    if (operation.state === 'succeeded') return { kind: 'spent' }
    if (operation.leaseExpiresAt && operation.leaseExpiresAt > new Date()) return { kind: 'busy' }

    const token = randomUUID()
    await tx
      .update(schema.AccountingDeliveryOperation)
      .set({
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + input.leaseMs),
        attempts: operation.attempts + 1,
      })
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          eq(schema.AccountingDeliveryOperation.id, operation.id)
        )
      )
    return { kind: 'claimed', operation, token }
  })
}

async function updateOwned(
  db: Database,
  operation: AccountingDeliveryOperationEntity,
  token: string,
  values: Partial<typeof schema.AccountingDeliveryOperation.$inferInsert>
) {
  const rows = await db
    .update(schema.AccountingDeliveryOperation)
    .set(values)
    .where(
      and(
        eq(schema.AccountingDeliveryOperation.organizationId, operation.organizationId),
        eq(schema.AccountingDeliveryOperation.id, operation.id),
        eq(schema.AccountingDeliveryOperation.leaseToken, token)
      )
    )
    .returning({ id: schema.AccountingDeliveryOperation.id })
  if (!rows.length) throw new Error('Withdrawal lease was lost')
}

/** Stamp the operation as having reached the provider, before the call that may not answer. */
export async function markUnsyncSending(
  db: Database,
  operation: AccountingDeliveryOperationEntity,
  token: string
): Promise<void> {
  await updateOwned(db, operation, token, { state: 'sending', firstSentAt: new Date() })
}

/**
 * Record a withdrawal that did not complete.
 *
 * 🛑 Writes NOTHING on `GlPosting` - §2.4. An `uncertain` delete leaves the row
 * `exported` with the provider's refusal on it, because the copy really may
 * still be in their books; a `blocked` one leaves it `exported` because the copy
 * certainly is.
 */
export async function markUnsyncFailed(
  db: Database,
  input: {
    operation: AccountingDeliveryOperationEntity
    token: string
    state: 'uncertain' | 'blocked'
    reason: string
  }
): Promise<void> {
  await updateOwned(db, input.operation, input.token, {
    state: input.state,
    failureReason: input.reason,
    leaseToken: null,
    leaseExpiresAt: null,
  })
}

/**
 * Step 5, in one transaction: the provider no longer holds it, so put the row
 * back to *Ready to sync*.
 *
 * The state table in §2.1 is the contract for what this writes, and two entries
 * in it are not obvious:
 *
 * - `deliveryIntent` is demoted to `manual` even when it was `automatic`. The
 *   sweep reads `automatic` as *sending* regardless of `releasedAt` and would
 *   re-create in the provider, within the minute, the object just deleted (§2.3).
 * - `providerId` is LEFT ALONE. Which system answered is history, and history is
 *   not undone by withdrawing from it.
 */
export async function saveWithdrawal(
  db: Database,
  input: {
    operation: AccountingDeliveryOperationEntity
    token: string
    deliveryId: string
    glPostingId: string
    externalObjectId: string
    /** The provider's own answer, kept verbatim as the operation's outcome. */
    outcome: Record<string, unknown>
  }
): Promise<void> {
  const { operation } = input
  const organizationId = operation.organizationId

  await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)

    const owned = await tx
      .update(schema.AccountingDeliveryOperation)
      .set({
        state: 'succeeded',
        outcome: input.outcome,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        failureReason: null,
      })
      .where(
        and(
          eq(schema.AccountingDeliveryOperation.organizationId, organizationId),
          eq(schema.AccountingDeliveryOperation.id, operation.id),
          eq(schema.AccountingDeliveryOperation.leaseToken, input.token)
        )
      )
      .returning({ id: schema.AccountingDeliveryOperation.id })
    if (!owned.length) throw new Error('Withdrawal lease was lost before saving the outcome')

    await tx
      .update(schema.ExternalAccountingObject)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(schema.ExternalAccountingObject.organizationId, organizationId),
          eq(schema.ExternalAccountingObject.id, input.externalObjectId)
        )
      )

    // The epoch bump is what makes the next Sync plan a NEW `journal:<n>`
    // operation rather than resetting the spent one (§2.1).
    await tx
      .update(schema.AccountingDelivery)
      .set({
        state: 'pending',
        releasedAt: null,
        completedAt: null,
        attemptEpoch: sql`${schema.AccountingDelivery.attemptEpoch} + 1`,
      })
      .where(
        and(
          eq(schema.AccountingDelivery.organizationId, organizationId),
          eq(schema.AccountingDelivery.id, input.deliveryId)
        )
      )

    await tx
      .update(schema.GlPosting)
      .set({
        exportStatus: 'pending',
        providerEntryId: null,
        providerTenantId: null,
        failureReason: null,
        deliveryIntent: 'manual',
      })
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.id, input.glPostingId)
        )
      )
  })
}
