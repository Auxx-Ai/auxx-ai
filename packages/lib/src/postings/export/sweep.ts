// packages/lib/src/postings/export/sweep.ts
// The scheduled half: batches nothing woke up for. Late send, never lost.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { readExportSettings } from '../read-export-settings'
import { MAX_AUTO_ATTEMPTS, type SendExportBatchResult, sendExportBatch } from './send'

const logger = createScopedLogger('postings:export-sweep')

export interface SweepExportBatchesInput {
  organizationId?: string
  limit?: number
  timeBudgetMs?: number
}

/**
 * Send every batch that is due.
 *
 * Due means `ready` on an avenue whose `autoSend` is on, or `failed` past its
 * `nextAttemptAt` and inside {@link MAX_AUTO_ATTEMPTS}. A held batch - `ready`
 * with `autoSend` off - is never touched: releasing it is a person's act
 * (TARGET §4 gate 2).
 */
export async function sweepExportBatches(
  db: Database,
  input: SweepExportBatchesInput = {}
): Promise<{ examined: number; results: SendExportBatchResult[] }> {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100))
  const now = new Date()
  const due = await db
    .select({
      id: schema.ExportBatch.id,
      organizationId: schema.ExportBatch.organizationId,
      avenue: schema.ExportBatch.avenue,
      state: schema.ExportBatch.state,
    })
    .from(schema.ExportBatch)
    .where(
      and(
        input.organizationId
          ? eq(schema.ExportBatch.organizationId, input.organizationId)
          : undefined,
        or(
          eq(schema.ExportBatch.state, 'ready'),
          and(
            eq(schema.ExportBatch.state, 'failed'),
            lte(schema.ExportBatch.nextAttemptAt, now),
            lt(schema.ExportBatch.attempts, MAX_AUTO_ATTEMPTS)
          )
        ),
        or(isNull(schema.ExportBatch.leaseExpiresAt), lte(schema.ExportBatch.leaseExpiresAt, now))
      )
    )
    .orderBy(
      // Plan 67 §5.2: a Payment waits on the invoice its `appliesTo` names, so
      // sending in document-date order sends the invoice first without either
      // object knowing about the other's existence.
      sql`(${schema.ExportBatch.payload}->>'txnDate') ASC`,
      asc(schema.ExportBatch.createdAt)
    )
    .limit(limit)

  const autoSendByOrg = new Map<string, Record<string, boolean>>()
  const results: SendExportBatchResult[] = []
  const deadline = Date.now() + Math.max(1, input.timeBudgetMs ?? 30_000)
  for (const batch of due) {
    if (Date.now() >= deadline) break
    let autoSend = autoSendByOrg.get(batch.organizationId)
    if (!autoSend) {
      autoSend = (await readExportSettings(db, batch.organizationId)).autoSend
      autoSendByOrg.set(batch.organizationId, autoSend)
    }
    // A `failed` batch was already released once, so the hold does not re-apply
    // to it; only a `ready` one is still waiting for somebody to say go.
    if (batch.state === 'ready' && !autoSend[batch.avenue]) continue
    const sent = await sendExportBatch(db, {
      organizationId: batch.organizationId,
      batchId: batch.id,
    })
    if (sent.isErr()) {
      logger.warn('Export batch sweep could not send a batch', {
        organizationId: batch.organizationId,
        batchId: batch.id,
        error: sent.error.message,
      })
      continue
    }
    results.push(sent.value)
  }
  return { examined: results.length, results }
}
