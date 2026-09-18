// packages/lib/src/postings/export/send.ts
// Lease one batch, hand its frozen payload to the provider, prove it landed,
// and record the answer. See plans/accounting/TARGET.md §3.

import { randomUUID } from 'node:crypto'
import { type Database, type ExportBatchEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { type ProviderObjectContext, resolveAccountingProvider } from '../provider'
import { hashExportPayload } from './payloads/journal'

const logger = createScopedLogger('postings:export-send')

/** How long one worker owns a batch before another may take it. */
const LEASE_MS = 5 * 60_000
/** How many times the SWEEP tries a batch before it needs a person. */
export const MAX_AUTO_ATTEMPTS = 3
/** Backoff per attempt already spent, so a rate limit is not met with a flat minute. */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000]

export type SendExportBatchStatus =
  | 'sent'
  | 'already_sent'
  | 'not_connected'
  | 'disabled'
  | 'leased_elsewhere'
  | 'failed'
  /** A dependency - a Payment's invoice - has not sent yet (plan 67 §5.2). */
  | 'waiting'

export interface SendExportBatchResult {
  batchId: string
  status: SendExportBatchStatus
  providerObjectId?: string
  /** The refusal, verbatim. Present on `failed` alone. */
  error?: string
  attempts: number
}

const scoped = (organizationId: string, id: string) =>
  and(eq(schema.ExportBatch.organizationId, organizationId), eq(schema.ExportBatch.id, id))

/**
 * Take the lease, or answer that somebody else holds it.
 *
 * `manual` resets `attempts`: that column is the sweep's budget, and a person
 * pressing Retry has asserted that whatever blocked this is fixed.
 */
async function lease(
  db: Database,
  organizationId: string,
  batchId: string,
  manual: boolean
): Promise<{ batch: ExportBatchEntity; token: string } | 'leased' | 'gone' | 'terminal'> {
  const token = randomUUID()
  const now = new Date()
  const [batch] = await db
    .select()
    .from(schema.ExportBatch)
    .where(scoped(organizationId, batchId))
    .limit(1)
  if (!batch) return 'gone'
  if (batch.state === 'sent') return 'terminal'
  if (batch.state === 'withdrawn') return 'terminal'
  const [taken] = await db
    .update(schema.ExportBatch)
    .set({
      state: 'sending',
      leaseToken: token,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: manual ? 1 : batch.attempts + 1,
      nextAttemptAt: null,
    })
    .where(
      and(
        scoped(organizationId, batchId),
        // In the WHERE, not in JS: two workers reading the same free lease must
        // not both win, and only the update can settle that.
        or(isNull(schema.ExportBatch.leaseExpiresAt), lte(schema.ExportBatch.leaseExpiresAt, now))
      )
    )
    .returning()
  if (!taken) return 'leased'
  return { batch: taken, token }
}

async function releaseOwned(
  db: Database,
  batch: ExportBatchEntity,
  token: string,
  values: Partial<typeof schema.ExportBatch.$inferInsert>
): Promise<boolean> {
  const rows = await db
    .update(schema.ExportBatch)
    .set({ ...values, leaseToken: null, leaseExpiresAt: null })
    .where(and(scoped(batch.organizationId, batch.id), eq(schema.ExportBatch.leaseToken, token)))
    .returning({ id: schema.ExportBatch.id })
  return rows.length > 0
}

/**
 * Prove the provider holds what we sent.
 *
 * Compared by `payloadHash` when the provider can produce one, and by document
 * number and total when it cannot. `unsupported` is not a failure: a provider
 * with no per-object read cannot answer, and refusing the send afterwards would
 * withdraw an object that is correctly there. Today QuickBooks answers
 * `found` off its document-number lookup and reports no hash, so the comparison
 * is the weaker of the two until the app ships per-object reads (MIGRATION
 * step 2, "Provider read tools").
 */
function readbackMismatch(
  batch: ExportBatchEntity,
  read: {
    status: 'found' | 'gone' | 'unsupported'
    docNumber: string | null
    totalMinor: number | null
    payloadHash: string | null
  }
): string | null {
  if (read.status === 'unsupported') return null
  if (read.status === 'gone')
    return 'The provider does not hold the object we just created; nothing was recorded.'
  if (read.payloadHash)
    return read.payloadHash === batch.payloadHash
      ? null
      : 'What the provider holds does not match the payload this batch froze.'
  const expected = (batch.payload as { docNumber?: unknown }).docNumber
  if (read.docNumber !== null && typeof expected === 'string' && read.docNumber !== expected)
    return `The provider holds document ${read.docNumber} where this batch sent ${expected}.`
  if (read.totalMinor !== null && read.totalMinor !== batch.totalMinor)
    return `The provider's total ${read.totalMinor} does not match this batch's ${batch.totalMinor}.`
  return null
}

/**
 * Send one batch.
 *
 * Never throws; every outcome is a {@link SendExportBatchResult}. A provider
 * fault leaves the batch `failed` with a backoff, capped at
 * {@link MAX_AUTO_ATTEMPTS} automatic attempts - past that the Retry button is
 * the only door.
 */
export async function sendExportBatch(
  db: Database,
  input: { organizationId: string; batchId: string; manual?: boolean }
): Promise<Result<SendExportBatchResult, Error>> {
  const { organizationId, batchId } = input
  const held = await lease(db, organizationId, batchId, input.manual === true)
  if (held === 'gone') return err(new NotFoundError('Export batch not found', { batchId }))
  if (held === 'terminal') return ok({ batchId, status: 'already_sent', attempts: 0 })
  if (held === 'leased') return ok({ batchId, status: 'leased_elsewhere', attempts: 0 })

  const { batch, token } = held
  const ctx: ProviderObjectContext = { organizationId, connectionId: batch.connectionId }

  try {
    const provider = await resolveAccountingProvider(organizationId)
    const sent = await provider.sendObject(ctx, {
      objectType: batch.objectType,
      payload: batch.payload,
      // Derived from the batch identity alone, so every retry carries the same
      // key and the provider's idempotency guarantee fires where it exists.
      idempotencyKey: hashExportPayload([batch.id, batch.payloadHash]),
    })
    if (sent.isErr()) return ok(await fail(db, batch, token, sent.error.message))
    const result = sent.value

    if (result.status === 'not_connected' || result.status === 'disabled') {
      // Not a fault, so it does not spend the sweep's budget: an org that
      // switched journal export off would otherwise exhaust three attempts and
      // need a person to press Retry once it was switched back on.
      const attempts = Math.max(0, batch.attempts - 1)
      await releaseOwned(db, batch, token, { state: 'ready', attempts })
      return ok({ batchId, status: result.status, attempts })
    }

    if (result.status === 'waiting') {
      // Plan 67 §5.2: a Payment waiting on its invoice is not a fault either -
      // it releases the lease and waits for the invoice's own batch to send,
      // which the sweep's `txnDate, createdAt` order normally does first.
      const attempts = Math.max(0, batch.attempts - 1)
      await releaseOwned(db, batch, token, {
        state: 'ready',
        attempts,
        lastError: result.waitingReason ?? 'Waiting for a dependency to send',
      })
      return ok({ batchId, status: 'waiting', attempts })
    }

    const read = await provider.readObject(ctx, {
      objectType: batch.objectType,
      externalId: result.externalId || null,
      docNumber: (batch.payload as { docNumber?: string }).docNumber ?? null,
    })
    if (read.isErr()) return ok(await fail(db, batch, token, read.error.message))
    const mismatch = readbackMismatch(batch, read.value)
    if (mismatch) return ok(await fail(db, batch, token, mismatch))

    const kept = await releaseOwned(db, batch, token, {
      state: 'sent',
      providerObjectId: result.externalId,
      providerSyncToken: read.value.remoteVersion ?? result.remoteVersion,
      sentAt: new Date(),
      lastError: null,
      nextAttemptAt: null,
    })
    if (!kept) return ok({ batchId, status: 'leased_elsewhere', attempts: batch.attempts })

    logger.info('Export batch sent', {
      organizationId,
      batchId,
      avenue: batch.avenue,
      providerObjectId: result.externalId,
    })
    return ok({
      batchId,
      status: 'sent',
      providerObjectId: result.externalId,
      attempts: batch.attempts,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return ok(await fail(db, batch, token, message))
  }
}

async function fail(
  db: Database,
  batch: ExportBatchEntity,
  token: string,
  reason: string
): Promise<SendExportBatchResult> {
  // `batch.attempts` already counts this attempt - `lease` incremented it - so
  // the backoff is indexed one behind.
  const spent = Math.max(0, batch.attempts - 1)
  const backoff = RETRY_BACKOFF_MS[Math.min(spent, RETRY_BACKOFF_MS.length - 1)] ?? 60_000
  await releaseOwned(db, batch, token, {
    state: 'failed',
    lastError: reason,
    nextAttemptAt: new Date(Date.now() + backoff),
  })
  if (batch.attempts >= MAX_AUTO_ATTEMPTS)
    logger.warn('Export batch will not be retried automatically; it needs a person', {
      organizationId: batch.organizationId,
      batchId: batch.id,
      attempts: batch.attempts,
      error: reason,
    })
  return { batchId: batch.id, status: 'failed', error: reason, attempts: batch.attempts }
}
