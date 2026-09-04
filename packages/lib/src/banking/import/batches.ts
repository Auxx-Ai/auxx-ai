// packages/lib/src/banking/import/batches.ts

/**
 * Every statement import that has been filed against an account.
 *
 * 🛑 **The batches are derived from the ROWS, not from `ImportJob`.** An import
 * job is deleted when a person starts over, and a job that ran but was never
 * filed against an account wrote no `bank_transaction` at all. Listing jobs would
 * therefore offer "Reverse this import" for imports that have nothing to reverse
 * and hide ones that do. The rows carrying an `importBatchId` ARE the batch -
 * which is also why reversing one is idempotent: once the rows are gone the
 * batch stops existing.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from '../guard'
import { listBankAccounts } from '../reads'
import { hydrateTransactions, requireBankTransactionImportContext } from './fields'
import { refusalReason } from './reverse'
import type { BankImportBatch } from './types'

/**
 * The org's import batches, newest first.
 *
 * `bankAccountId` narrows it to one account, which is what the import page
 * renders once an account is chosen.
 */
export async function listImportBatches(
  db: Database,
  params: { organizationId: string; bankAccountId?: string }
): Promise<Result<BankImportBatch[], Error>> {
  const { organizationId, bankAccountId } = params
  return guard(
    async () => {
      const ctx = await requireBankTransactionImportContext(organizationId)
      const batchFieldId = ctx.fields.bank_transaction_import_batch_id?.id
      if (!batchFieldId) return []

      const stamped = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.fieldId, batchFieldId),
            isNotNull(schema.FieldValue.valueText)
          )
        )

      const rows = await hydrateTransactions(db, organizationId, ctx, [
        ...new Set(stamped.map((row) => row.entityId)),
      ])
      const scoped = bankAccountId
        ? rows.filter((row) => row.bankAccountId === bankAccountId)
        : rows

      const accounts = await listBankAccounts(db, { organizationId })
      const nameById = new Map(
        (accounts.isOk() ? accounts.value : []).map((account) => [account.id, account.name])
      )

      const byBatch = new Map<string, BankImportBatch>()
      for (const row of scoped) {
        if (!row.importBatchId) continue
        const batch = byBatch.get(row.importBatchId) ?? {
          importBatchId: row.importBatchId,
          bankAccountId: row.bankAccountId,
          bankAccountName: row.bankAccountId ? (nameById.get(row.bankAccountId) ?? null) : null,
          rowCount: 0,
          from: null,
          to: null,
          protectedCount: 0,
          firstSeenAt: null,
        }

        batch.rowCount += 1
        if (refusalReason(row)) batch.protectedCount += 1
        if (row.postedAt && (!batch.from || row.postedAt < batch.from)) batch.from = row.postedAt
        if (row.postedAt && (!batch.to || row.postedAt > batch.to)) batch.to = row.postedAt
        if (row.createdAt && (!batch.firstSeenAt || row.createdAt < batch.firstSeenAt)) {
          batch.firstSeenAt = row.createdAt
        }

        byBatch.set(row.importBatchId, batch)
      }

      return [...byBatch.values()].sort((a, b) => {
        const left = a.firstSeenAt?.getTime() ?? 0
        const right = b.firstSeenAt?.getTime() ?? 0
        return right - left
      })
    },
    'Failed to list bank statement import batches',
    { organizationId, bankAccountId }
  )
}
