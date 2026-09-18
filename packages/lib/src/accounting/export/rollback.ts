// packages/lib/src/accounting/export/rollback.ts
// Delete the provider's copy of a sent batch and free its postings for the next
// build. Un-sync is this action, not a lane of its own (TARGET §3).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, NotFoundError } from '../../errors'
import { type ProviderObjectContext, resolveAccountingProvider } from '../providers/provider'
import { INVOICE_OBJECT_TYPE } from './payloads/invoice'
import { PAYMENT_OBJECT_TYPE } from './payloads/payment'

const logger = createScopedLogger('postings:export-rollback')

export interface RollbackExportBatchResult {
  batchId: string
  /**
   * `withdrawn` removed the provider's copy, `already_gone` found none left -
   * both free the postings. `refused` changed nothing and says why.
   */
  status: 'withdrawn' | 'already_gone' | 'refused'
  message?: string
  /** True on the one refusal `force: true` may override. */
  forcible?: boolean
  postingsFreed: number
}

/**
 * A live `sent` Payment batch whose `appliesTo` names one of `invoiceBatchId`'s
 * own member postings, or null. 🛑 Rollback order (plan 67 §5.4): a Payment
 * must be withdrawn before the Invoice it applies to, so an Invoice batch
 * refuses to withdraw while one is still there.
 */
async function findBlockingPayment(
  db: Database,
  organizationId: string,
  invoiceBatchId: string
): Promise<{ id: string; docNumber: string | null } | null> {
  const members = await db
    .select({ glPostingId: schema.ExportBatchPosting.glPostingId })
    .from(schema.ExportBatchPosting)
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        eq(schema.ExportBatchPosting.batchId, invoiceBatchId),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
  const glPostingIds = members.map((member) => member.glPostingId)
  if (glPostingIds.length === 0) return null

  const payments = await db
    .select({ id: schema.ExportBatch.id, payload: schema.ExportBatch.payload })
    .from(schema.ExportBatch)
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.objectType, PAYMENT_OBJECT_TYPE),
        eq(schema.ExportBatch.state, 'sent')
      )
    )
  const blocking = payments.find((payment) => {
    const glPostingId = (payment.payload as { appliesTo?: { glPostingId?: string } })?.appliesTo
      ?.glPostingId
    return glPostingId ? glPostingIds.includes(glPostingId) : false
  })
  if (!blocking) return null
  return {
    id: blocking.id,
    docNumber: (blocking.payload as { docNumber?: string })?.docNumber ?? null,
  }
}

/**
 * Withdraw one batch.
 *
 * 🛑 An EXPORT operation, never a ledger one. Nothing here reverses, reopens a
 * period or releases a claim: the postings stay `posted` and come back to
 * *Ready*. Backing an entry out of OUR books is `reverseEntry`.
 *
 * `force` overrides the missing-token refusal alone, and it discards whatever
 * the provider holds under that id.
 */
export async function rollbackExportBatch(
  db: Database,
  input: { organizationId: string; batchId: string; force?: boolean }
): Promise<Result<RollbackExportBatchResult, Error>> {
  const { organizationId, batchId } = input
  try {
    const [batch] = await db
      .select()
      .from(schema.ExportBatch)
      .where(
        and(
          eq(schema.ExportBatch.organizationId, organizationId),
          eq(schema.ExportBatch.id, batchId)
        )
      )
      .limit(1)
    if (!batch) return err(new NotFoundError('Export batch not found', { batchId }))

    if (batch.state === 'withdrawn')
      return ok({ batchId, status: 'already_gone', postingsFreed: 0 })
    if (batch.state === 'sending')
      return ok({
        batchId,
        status: 'refused',
        message: 'This batch is being sent right now. Wait for it to settle, then roll it back.',
        postingsFreed: 0,
      })
    if (batch.state !== 'sent' || !batch.providerObjectId)
      return ok({
        batchId,
        status: 'refused',
        message:
          'Nothing was sent for this batch, so there is nothing to remove from the provider.',
        postingsFreed: 0,
      })
    if (!batch.providerSyncToken && !input.force)
      return ok({
        batchId,
        status: 'refused',
        forcible: true,
        message:
          'We hold no version for the provider’s copy, and it refuses a delete without one. Force the rollback to discard it anyway.',
        postingsFreed: 0,
      })

    if (batch.objectType === INVOICE_OBJECT_TYPE) {
      const blocking = await findBlockingPayment(db, organizationId, batchId)
      if (blocking)
        return ok({
          batchId,
          status: 'refused',
          message: `A payment (${blocking.docNumber ?? blocking.id}) applies to this invoice and is still sent. Roll that back first.`,
          postingsFreed: 0,
        })
    }

    const provider = await resolveAccountingProvider(organizationId)
    const ctx: ProviderObjectContext = { organizationId, connectionId: batch.connectionId }
    const withdrawn = await provider.withdrawObject(ctx, {
      objectType: batch.objectType,
      externalId: batch.providerObjectId,
      remoteVersion: batch.providerSyncToken,
    })
    // The provider's own sentence, verbatim: a closed period, a stale token or a
    // permission is their answer to give and there is nothing to add to it.
    if (withdrawn.isErr())
      return ok({
        batchId,
        status: 'refused',
        message: withdrawn.error.message,
        postingsFreed: 0,
      })

    const freed = await db.transaction(async (tx) => {
      await tx
        .update(schema.ExportBatch)
        .set({
          state: 'withdrawn',
          withdrawnAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(schema.ExportBatch.organizationId, organizationId),
            eq(schema.ExportBatch.id, batchId)
          )
        )
      const rows = await tx
        .update(schema.ExportBatchPosting)
        .set({ withdrawnAt: new Date() })
        .where(
          and(
            eq(schema.ExportBatchPosting.organizationId, organizationId),
            eq(schema.ExportBatchPosting.batchId, batchId),
            isNull(schema.ExportBatchPosting.withdrawnAt)
          )
        )
        .returning({ id: schema.ExportBatchPosting.id })
      return rows.length
    })

    logger.info('Export batch rolled back', {
      organizationId,
      batchId,
      status: withdrawn.value.status,
      postingsFreed: freed,
    })
    return ok({ batchId, status: withdrawn.value.status, postingsFreed: freed })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
