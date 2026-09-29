// packages/lib/src/accounting/export/withdraw-held-batch.ts

import { schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm'

/**
 * Withdraw the original's transaction batch while it still sits in Ready, so neither half of
 * the pair leaves (`reversalMayExport`). A batch already leased or sent is left alone.
 */
export async function withdrawHeldBatchInTx(
  tx: Transaction,
  organizationId: string,
  glPostingId: string
): Promise<void> {
  const live = await tx
    .select({ batchId: schema.ExportBatchPosting.batchId })
    .from(schema.ExportBatchPosting)
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        eq(schema.ExportBatchPosting.glPostingId, glPostingId),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
  if (live.length === 0) return

  const now = new Date()
  const withdrawn = await tx
    .update(schema.ExportBatch)
    .set({ state: 'withdrawn', withdrawnAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        inArray(
          schema.ExportBatch.id,
          live.map((row) => row.batchId)
        ),
        eq(schema.ExportBatch.mode, 'transaction'),
        eq(schema.ExportBatch.state, 'ready'),
        or(isNull(schema.ExportBatch.leaseExpiresAt), lte(schema.ExportBatch.leaseExpiresAt, now))
      )
    )
    .returning({ id: schema.ExportBatch.id })
  if (withdrawn.length === 0) return
  await tx
    .update(schema.ExportBatchPosting)
    .set({ withdrawnAt: now })
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        inArray(
          schema.ExportBatchPosting.batchId,
          withdrawn.map((row) => row.id)
        )
      )
    )
}
