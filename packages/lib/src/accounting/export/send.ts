// packages/lib/src/accounting/export/send.ts
// Lease one batch, hand its frozen payload to the provider, prove it landed,
// and record the answer. See plans/accounting/TARGET.md §3.

import { randomUUID } from 'node:crypto'
import { type Database, type ExportBatchEntity, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { ProviderPostError } from '../ledger/types'
import { type ProviderObjectContext, resolveAccountingProvider } from '../providers/provider'
import { hashExportPayload } from './payloads/journal'
import { exportBlockerSentence, readExportBatchBlockers } from './preflight'
import { exportBatchFrame, publishExportBatchState } from './realtime'

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
  manual: boolean,
  runId?: string
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
  if (runId) leaseRuns.set(taken, runId)
  // Awaited so a fast refusal's frame cannot overtake this one.
  await publishExportBatchState(organizationId, exportBatchFrame(taken, runId))
  return { batch: taken, token }
}

/** The run id each held lease was taken for, so settling can tag its frame without a new parameter. */
const leaseRuns = new WeakMap<ExportBatchEntity, string>()

async function releaseOwned(
  db: Database,
  batch: ExportBatchEntity,
  token: string,
  values: Partial<typeof schema.ExportBatch.$inferInsert>
): Promise<boolean> {
  const [settled] = await db
    .update(schema.ExportBatch)
    .set({ ...values, leaseToken: null, leaseExpiresAt: null })
    .where(and(scoped(batch.organizationId, batch.id), eq(schema.ExportBatch.leaseToken, token)))
    .returning()
  if (!settled) return false
  await publishExportBatchState(
    batch.organizationId,
    exportBatchFrame(settled, leaseRuns.get(batch))
  )
  return true
}

/**
 * Prove the provider holds what we sent.
 *
 * Compared by `payloadHash` when the provider can produce one, and by document
 * number and total when it cannot. `unsupported` is not a failure: a provider
 * with no per-object read cannot answer, and refusing the send afterwards would
 * withdraw an object that is correctly there. QuickBooks reports no hash, so
 * the comparison is the weaker of the two; it reads the create's echo (93 A2).
 */
function readbackMismatch(
  batch: ExportBatchEntity,
  providerId: string,
  read: {
    status: 'found' | 'gone' | 'unsupported'
    docNumber: string | null
    totalMinor: number | null
    payloadHash: string | null
  }
): ProviderPostError | null {
  // `data`, never `transport`: the object landed and disagrees with the
  // payload, so sending again would create a second one (89 D3).
  const refuse = (message: string) =>
    new ProviderPostError(message, { failureClass: 'data', providerId })
  if (read.status === 'unsupported') return null
  if (read.status === 'gone')
    return refuse('The provider does not hold the object we just created.')
  if (read.payloadHash)
    return read.payloadHash === batch.payloadHash
      ? null
      : refuse('What the provider holds does not match the payload this batch froze.')
  const expected = (batch.payload as { docNumber?: unknown }).docNumber
  if (read.docNumber !== null && typeof expected === 'string' && read.docNumber !== expected)
    return refuse(
      `The provider holds document ${read.docNumber} where this batch sent ${expected}.`
    )
  // What we SENT, not the postings' gross: a Deposit's total is the net of its
  // fee line, and the payload already carries the provider's own figure.
  const sent = (batch.payload as { totalMinor?: unknown }).totalMinor
  const expectedTotal = typeof sent === 'number' ? sent : batch.totalMinor
  if (read.totalMinor !== null && read.totalMinor !== expectedTotal)
    return refuse(
      `The provider's total ${read.totalMinor} does not match the ${expectedTotal} this batch sent.`
    )
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
  /** `runId` tags this send's realtime frames with the release that caused it (93 B2). */
  input: { organizationId: string; batchId: string; manual?: boolean; runId?: string }
): Promise<Result<SendExportBatchResult, Error>> {
  const { organizationId, batchId } = input
  const held = await lease(db, organizationId, batchId, input.manual === true, input.runId)
  if (held === 'gone') return err(new NotFoundError('Export batch not found', { batchId }))
  if (held === 'terminal') return ok({ batchId, status: 'already_sent', attempts: 0 })
  if (held === 'leased') return ok({ batchId, status: 'leased_elsewhere', attempts: 0 })

  const { batch, token } = held
  const ctx: ProviderObjectContext = { organizationId, connectionId: batch.connectionId }

  try {
    const provider = await resolveAccountingProvider(organizationId)

    // 89 D8: the mapping table lives here, so a send it already refuses is not
    // spent on a round trip. Runs on manual Retry too, and costs nothing.
    const blocked = await readExportBatchBlockers(db, organizationId, [
      { id: batch.id, payload: batch.payload },
    ])
    if (blocked.isErr()) return ok(await fail(db, batch, token, blocked.error))
    const blockers = blocked.value.get(batch.id)
    if (blockers && blockers.length > 0) {
      const refusal = new ProviderPostError(blockers.map(exportBlockerSentence).join(' '), {
        failureClass: 'configuration',
        providerId: provider.id,
        items: blockers,
      })
      return ok(await fail(db, batch, token, refusal))
    }

    const sent = await provider.sendObject(ctx, {
      objectType: batch.objectType,
      payload: batch.payload,
      // Derived from the batch identity alone, so every retry carries the same
      // key and the provider's idempotency guarantee fires where it exists.
      idempotencyKey: hashExportPayload([batch.id, batch.payloadHash]).slice(
        0,
        provider.limits?.idempotencyKeyLength
      ),
    })
    if (sent.isErr()) return ok(await fail(db, batch, token, sent.error))
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

    // 93 A2: the create's own answer is the read-back when the provider gives one.
    const read = result.echo
      ? ok({ status: 'found' as const, payloadHash: null, ...result.echo })
      : await provider.readObject(ctx, {
          objectType: batch.objectType,
          externalId: result.externalId || null,
          docNumber: (batch.payload as { docNumber?: string }).docNumber ?? null,
        })
    // The object exists at the provider from here on, whatever the read-back
    // says, so every refusal below carries its id.
    const landed = { externalId: result.externalId, remoteVersion: result.remoteVersion }
    if (read.isErr()) return ok(await fail(db, batch, token, read.error, landed))
    const mismatch = readbackMismatch(batch, provider.id, read.value)
    if (mismatch) return ok(await fail(db, batch, token, mismatch, landed))

    const kept = await releaseOwned(db, batch, token, {
      state: 'sent',
      providerObjectId: result.externalId,
      providerSyncToken: read.value.remoteVersion ?? result.remoteVersion,
      sentAt: new Date(),
      lastError: null,
      failureClass: null,
      failureItems: [],
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
    return ok(await fail(db, batch, token, error instanceof Error ? error : String(error)))
  }
}

async function fail(
  db: Database,
  batch: ExportBatchEntity,
  token: string,
  /** The adapter's own error when there is one - that is where the class and the items are (89 D4). */
  reason: Error | string,
  /**
   * What the provider created before the failure, when it created anything.
   * A create that lands and then fails its read-back would otherwise leave an
   * object at the provider that nothing here names: unwithdrawable, and
   * invisible to a Payment waiting on it. Safe against the mirror, which reads
   * `state = 'sent'` on both queries.
   */
  created?: { externalId: string; remoteVersion: string | null }
): Promise<SendExportBatchResult> {
  const message = typeof reason === 'string' ? reason : reason.message
  const posted = reason instanceof ProviderPostError ? reason : null
  // `batch.attempts` already counts this attempt - `lease` incremented it - so
  // the backoff is indexed one behind.
  const spent = Math.max(0, batch.attempts - 1)
  const backoff = RETRY_BACKOFF_MS[Math.min(spent, RETRY_BACKOFF_MS.length - 1)] ?? 60_000
  // 89 D3: only `transport` (and an unclassified throw) is worth another
  // attempt, and a null `nextAttemptAt` is already outside the sweep's window.
  const retryable = posted === null || posted.failureClass === 'transport'
  await releaseOwned(db, batch, token, {
    state: 'failed',
    lastError: message,
    failureClass: posted?.failureClass ?? null,
    failureItems: posted?.items ?? [],
    nextAttemptAt: retryable ? new Date(Date.now() + backoff) : null,
    ...(created?.externalId && {
      providerObjectId: created.externalId,
      providerSyncToken: created.remoteVersion,
    }),
  })
  if (batch.attempts >= MAX_AUTO_ATTEMPTS)
    logger.warn('Export batch will not be retried automatically; it needs a person', {
      organizationId: batch.organizationId,
      batchId: batch.id,
      attempts: batch.attempts,
      error: message,
    })
  return {
    batchId: batch.id,
    status: 'failed',
    error: message,
    attempts: batch.attempts,
    ...(created?.externalId && { providerObjectId: created.externalId }),
  }
}
