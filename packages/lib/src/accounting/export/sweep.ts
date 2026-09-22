// packages/lib/src/accounting/export/sweep.ts
// The scheduled half: batches nothing woke up for. Late send, never lost.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { readOrganizationSettings } from '../../settings/read'
import { periodKeyForDate } from '../ledger/periods/periods'
import { EXPORT_AVENUES, isSummaryGrainAvenue } from '../ledger/setup/export-settings'
import { readExportSettings } from '../ledger/setup/read-export-settings'
import { MAX_AUTO_ATTEMPTS, type SendExportBatchResult, sendExportBatch } from './send'
import { sendSummaryBucket } from './send-bucket'
import { listSummaryRows } from './summary-rows'

const logger = createScopedLogger('postings:export-sweep')

/** Buckets the build rule sends per org per run; a backlog drains over several runs. */
export const SUMMARY_BUCKETS_PER_SWEEP = 50
/** Rows read per run - more than the cap, so a few stuck oldest buckets cannot starve the rest. */
const SUMMARY_BUCKET_SCAN = 200
/** A day bucket waits this many whole days past its own before it builds (95 D1). */
const DAY_GRAIN_WAIT_DAYS = 2

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
 * (TARGET §4 gate 2). With an `organizationId`, then runs {@link sweepSummaryBuckets}.
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
      autoSend = (await readExportSettings(batch.organizationId)).autoSend
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
  if (input.organizationId && Date.now() < deadline) {
    const buckets = await sweepSummaryBuckets(db, {
      organizationId: input.organizationId,
      timeBudgetMs: deadline - Date.now(),
    })
    results.push(...buckets)
  }
  return { examined: results.length, results }
}

/**
 * Whether a bucket's grain is closed on `today` (book-zone `YYYY-MM-DD`): a day
 * more than {@link DAY_GRAIN_WAIT_DAYS} days back, a month once the next has begun,
 * a grain-less bucket (one posting) at once.
 */
export function isSummaryBucketComplete(
  grainKey: string,
  today: string,
  /** A payout bucket's latest posting day: it closes by the day rule its catch-all uses (91 D9). */
  payoutLastDay?: string
): boolean {
  if (/^\d{4}-\d{2}$/.test(grainKey)) return grainKey < today.slice(0, 7)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(grainKey) ? grainKey : payoutLastDay
  if (!day) return true
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - DAY_GRAIN_WAIT_DAYS)
  return day < cutoff.toISOString().slice(0, 10)
}

/**
 * The build rule (95 §3.4, D1): send every `Not sent` bucket whose grain is
 * complete on an `autoSend` avenue. Never rebuilds a sent one (D3).
 */
export async function sweepSummaryBuckets(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SendExportBatchResult[]> {
  const { organizationId } = input
  const settings = await readExportSettings(organizationId)
  if (settings.mode !== 'summary') return []
  const avenues = EXPORT_AVENUES.filter((avenue) => settings.autoSend[avenue])
  if (avenues.length === 0) return []

  const zone = (await readOrganizationSettings(organizationId, ['accounting.bookTimeZone']))[
    'accounting.bookTimeZone'
  ]
  const today = periodKeyForDate(new Date(), 'day', zone?.trim() || 'UTC')

  // `listSummaryRows` is empty without an active book connection.
  const rows = await listSummaryRows(db, {
    organizationId,
    tab: 'ready',
    categories: avenues,
    direction: 'asc',
    limit: SUMMARY_BUCKET_SCAN,
  })
  if (rows.isErr()) {
    logger.warn('Summary sweep could not read buckets', {
      organizationId,
      error: rows.error.message,
    })
    return []
  }

  const due = rows.value.items
    .filter((row) => row.status === 'not_sent' && !row.batch)
    .filter((row) =>
      isSummaryBucketComplete(
        row.grainKey,
        today,
        isSummaryGrainAvenue(row.avenue) && settings.summaryGrain[row.avenue] === 'payout'
          ? row.txnDateTo
          : undefined
      )
    )
    .slice(0, input.limit ?? SUMMARY_BUCKETS_PER_SWEEP)

  const results: SendExportBatchResult[] = []
  const deadline = Date.now() + Math.max(1, input.timeBudgetMs ?? 30_000)
  for (const row of due) {
    if (Date.now() >= deadline) break
    const key = {
      avenue: row.avenue,
      grainKey: row.grainKey,
      storeId: row.storeId,
      railId: row.railId,
      currency: row.currency,
    }
    const sent = await sendSummaryBucket(db, { organizationId, key })
    if (sent.isErr()) {
      logger.warn('Summary sweep could not send a bucket', {
        organizationId,
        bucket: row.key,
        error: sent.error.message,
      })
      continue
    }
    logger.info('Summary sweep sent a bucket', {
      organizationId,
      bucket: row.key,
      batchId: sent.value.batchId,
      status: sent.value.status,
    })
    results.push(sent.value)
  }
  return results
}
