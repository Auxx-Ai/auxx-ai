// packages/lib/src/postings/retry-export.ts
//
// Re-push one entry that is already in the books to the accounting provider.
//
// This is the operation `post-entry.ts` shipped without and its own comments
// called owed. Before the export split it could not be written honestly: a
// refused push left the row `failed`, so "retry" would have had to mean
// "re-post", and re-posting a claimed period converges on `already_posted`
// without ever reaching the provider. Splitting the two states makes this what
// it always should have been - a second attempt at a COPY, touching nothing the
// ledger owns.
//
// 🛑 **`status` is never written here.** Not on success, not on failure, not in
// any branch. The entry was posted when its claim committed; this file exists
// to change the answer to a different question. See
// plans/accounting/export-state-split.md.
//
// No permission checks. The router asserts `ledgerPost` (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { ConflictError, NotFoundError } from '../errors'
import { enqueueAccountingDelivery, planAccountingDeliveryInTx } from './delivery'
import { resolveAccountingProvider } from './provider'
import { EXPORT_ROUTE_BY_POSTING_TYPE } from './regime'
import type {
  CounterpartyType,
  PostEntryInput,
  PostingType,
  PostResult,
  ResolvedPostingLine,
} from './types'

const logger = createScopedLogger('postings-retry-export')

/**
 * Retry the export of one posting.
 *
 * **Never throws.** Every outcome is a `PostResult`, like `postEntry`.
 *
 * 🛑 The lines are replayed from `GlPostingLine`, NOT rebuilt and NOT
 * re-resolved through the role map. Those rows froze `accountCode` at post time,
 * and re-resolving would export whatever the role map says today - so an entry
 * booked under one mapping could be exported under another, and our ledger and
 * the provider's register would disagree about the same document with nothing
 * able to detect it. Export what was booked.
 *
 * ⚠️ Re-mapping an account and retrying still works, because the adapter
 * resolves the line's `glAccountId` to a provider id at push time through the
 * account map (`quickbooks-accounting-provider.ts`'s `resolveMappedAccounts`),
 * not by re-reading `accountCode` - which may be null (task 15 §5). The fix
 * for the usual failure is upstream of this replay, not inside it.
 *
 * The row's own `requestId` and `docNumber` are reused verbatim. That is the
 * entire point: the provider's idempotency contract only fires when the key is
 * the one the first attempt used, and this is the case it exists for.
 */
export async function retryExport(
  db: Database,
  input: { organizationId: string; glPostingId: string }
): Promise<Result<PostResult, Error>> {
  const { organizationId, glPostingId } = input

  try {
    const [row] = await db
      .select({
        id: schema.GlPosting.id,
        postingType: schema.GlPosting.postingType,
        periodKey: schema.GlPosting.periodKey,
        revision: schema.GlPosting.revision,
        txnDate: schema.GlPosting.txnDate,
        docNumber: schema.GlPosting.docNumber,
        requestId: schema.GlPosting.requestId,
        exportStatus: schema.GlPosting.exportStatus,
        built: schema.GlPosting.built,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.id, glPostingId),
          eq(schema.GlPosting.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!row) {
      return err(new NotFoundError('Posting not found', { glPostingId, organizationId }))
    }

    // TODO(step-3): `GlPosting.deliveryIntent` is gone (§0b), so there is no
    // delivery pipeline to defer to any more - every retry pushes inline.
    // `exported` is a no-op success rather than a refusal: two people pressing
    // Retry on the same row should both be told it is exported, not one of them
    // handed an error for having been second.
    if (row.exportStatus === 'exported') {
      return ok({
        status: 'already_posted',
        exportStatus: 'exported',
        glPostingId,
        docNumber: row.docNumber ?? undefined,
      })
    }

    // 🛑 `not_required` means nothing is connected, or pushing is off. Retrying
    // would resolve the `none` provider and stamp `not_required` again, which
    // reads to the operator as "I tried and it worked" when nothing was tried.
    if (row.exportStatus === 'not_required') {
      // ⚠️ Three reasons produce `not_required` and only two of them are about
      // the organization. A `'none'`-routed posting type is never exported at
      // all, so telling the operator to check a connection they may well have
      // sends them to debug something healthy - the same defect as the close
      // console's `not_connected` copy (brief 22 §5).
      const routedToNone = EXPORT_ROUTE_BY_POSTING_TYPE[row.postingType as PostingType] === 'none'
      return err(
        new ConflictError(
          routedToNone
            ? `${row.docNumber} is never exported. An opening balance and an entry synced ` +
                'from your accounting system are both kept here only, because pushing either ' +
                'back would hand the provider a second copy of a figure it already has.'
            : `${row.docNumber} has no export to retry: this organization has no accounting ` +
                'system connected, or posting journal entries to it is switched off.',
          { glPostingId }
        )
      )
    }

    const lineRows = await db
      .select({
        glAccountId: schema.GlPostingLine.glAccountId,
        accountCode: schema.GlPostingLine.accountCode,
        accountName: schema.GlPostingLine.accountName,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
        memo: schema.GlPostingLine.memo,
        sourceType: schema.GlPostingLine.sourceType,
        sourceId: schema.GlPostingLine.sourceId,
        lineNumber: schema.GlPostingLine.lineNumber,
        counterpartyType: schema.GlPostingLine.counterpartyType,
        counterpartyId: schema.GlPostingLine.counterpartyId,
        dimensions: schema.GlPostingLine.dimensions,
      })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.organizationId, organizationId),
          eq(schema.GlPostingLine.glPostingId, glPostingId)
        )
      )
      .orderBy(asc(schema.GlPostingLine.lineNumber))

    if (lineRows.length === 0) {
      // A posted header with no lines is corruption, not an export problem, and
      // `verifyBooksBalance` is the thing that reports it. Pushing an empty
      // entry would hand the provider a 0 = 0 journal that balances.
      return err(
        new ConflictError(
          `${row.docNumber} has no lines. It cannot be exported, and a posted header ` +
            'with no lines is a discrepancy - run the books balance check.',
          { glPostingId }
        )
      )
    }

    const lines: ResolvedPostingLine[] = lineRows.map((line) => ({
      glAccountId: line.glAccountId,
      accountCode: line.accountCode,
      accountName: line.accountName ?? undefined,
      direction: line.direction,
      amount: line.amountMinor,
      memo: line.memo ?? undefined,
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sortOrder: line.lineNumber,
      // Replayed FROZEN (brief 13 §1.1 third bullet), never re-resolved: a
      // retry exports under the attribution the ledger asserted when it
      // posted, not whatever the record has since been renamed or merged to.
      counterpartyType: (line.counterpartyType as CounterpartyType | null) ?? undefined,
      counterpartyId: line.counterpartyId ?? undefined,
      // Replayed too (brief 13 §5). QuickBooks has no seam for it yet - the
      // adapter simply ignores a field it does not read - so this is inert
      // until the ClassRef/DepartmentRef hop exists, which is not this unit.
      dimensions: (line.dimensions as Record<string, string> | null) ?? undefined,
    }))

    const draft = (row.built ?? {}) as { memo?: unknown }
    const provider = await resolveAccountingProvider(organizationId)

    const payload: PostEntryInput = {
      organizationId,
      glPostingId,
      revision: row.revision,
      postingType: row.postingType,
      periodKey: row.periodKey,
      txnDate: row.txnDate,
      // Non-null: a row with an export to retry was posted, which assigns one.
      docNumber: row.docNumber ?? '',
      lines,
      // The row's own key, never a fresh one. See the JSDoc.
      idempotencyKey: row.requestId,
      memo: typeof draft.memo === 'string' ? draft.memo : undefined,
    }

    const pushed = await provider.postEntry(payload)

    if (pushed.isErr()) {
      const reason = pushed.error instanceof Error ? pushed.error.message : String(pushed.error)
      await db
        .update(schema.GlPosting)
        .set({
          exportStatus: 'failed',
          failureReason: reason,
          providerId: provider.id,
          attempts: sql`${schema.GlPosting.attempts} + 1`,
        })
        .where(
          and(
            eq(schema.GlPosting.id, glPostingId),
            eq(schema.GlPosting.organizationId, organizationId)
          )
        )

      logger.error('Export retry refused. The entry is still posted', {
        organizationId,
        glPostingId,
        docNumber: row.docNumber,
        providerId: provider.id,
        error: reason,
      })

      return ok({
        status: 'posted',
        exportStatus: 'failed',
        glPostingId,
        docNumber: row.docNumber ?? undefined,
        providerId: provider.id,
        error: reason,
      })
    }

    const result = pushed.value
    const exportStatus =
      result.status === 'not_connected' || result.status === 'disabled'
        ? ('not_required' as const)
        : ('exported' as const)

    await db
      .update(schema.GlPosting)
      .set({
        exportStatus,
        providerId: result.providerId,
        providerEntryId: result.externalId || null,
        // 🛑 The same stamp `post-entry.ts`'s `markExported` writes, and it has
        // to be written HERE too or the retry path silently produces an
        // exported row whose company can never be reconstructed (task 24 §2.2).
        // A row that reaches the books through a retry is the ordinary case for
        // anything that failed once; it is not an edge.
        providerTenantId: result.tenantId || null,
        // Cleared for `markExported`'s reason: the refusal recorded here names
        // an attempt this success has superseded, and every reader takes it as
        // current. `attempts` stays (task 24 §6.2).
        failureReason: null,
      })
      .where(
        and(
          eq(schema.GlPosting.id, glPostingId),
          eq(schema.GlPosting.organizationId, organizationId)
        )
      )

    logger.info('Export retried', {
      organizationId,
      glPostingId,
      docNumber: row.docNumber,
      providerId: result.providerId,
      providerStatus: result.status,
    })

    return ok({
      status: result.status,
      exportStatus,
      glPostingId,
      docNumber: row.docNumber ?? undefined,
      providerId: result.providerId,
      providerEntryId: result.externalId || undefined,
      providerTenantId: result.tenantId || undefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Export retry failed', { organizationId, glPostingId, error: message })
    return err(error instanceof Error ? error : new Error(message))
  }
}

/**
 * What one posting did when the sync queue asked for it.
 *
 * `released` is the ordinary answer and it is deliberately not "sent": this
 * hands the journal to the delivery worker and returns. Nothing here waits on a
 * provider.
 */
export interface SyncReleaseOutcome {
  glPostingId: string
  docNumber: string | null
  status: 'released' | 'exported' | 'skipped' | 'error'
  /** Why it was skipped, or what went wrong. `undefined` on `released`. */
  message?: string
}

/** The tally the queue renders, plus the per-posting detail behind it. */
export interface SyncReleaseResult {
  released: number
  skipped: number
  failed: number
  outcomes: SyncReleaseOutcome[]
}

/**
 * Release held journals to the delivery worker - the sync queue's bulk action
 * (plans/accounting/tasks/53-two-modes-one-ledger.md §7.2).
 *
 * 🛑 **Releases; does not push.** This hands each row to
 * `planAccountingDeliveryInTx` (which creates the delivery row when the
 * worker has not planned one yet) and enqueues the ordinary delivery job -
 * never `deliverAccountingPosting` per row, the way {@link retryExport} does
 * for one: an export is three to five sequential round trips to a
 * rate-limited third party, and a bulk bar acts on a backlog of them at once.
 *
 * TODO(step-3): `GlPosting.deliveryIntent` is gone (§0b) - every row is
 * treated as manual intent now, so there is no "legacy row" branch left to
 * fall back to `retryExport` for; `planAccountingDeliveryInTx` itself handles
 * every row uniformly until the export batch replaces this queue.
 *
 * **Never throws.** One posting refusing does not stop the rest - the whole
 * point of a bulk action over a backlog is that it reports the exceptions rather
 * than aborting on the first one.
 */
export async function releaseExportsForSync(
  db: Database,
  input: { organizationId: string; glPostingIds: string[] }
): Promise<Result<SyncReleaseResult, Error>> {
  const { organizationId } = input
  // De-duped: a list built from checkboxes over a list that re-fetched underneath
  // somebody can carry the same id twice, and releasing twice is two enqueues.
  const glPostingIds = [...new Set(input.glPostingIds)]

  try {
    const rows = await db
      .select({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        exportStatus: schema.GlPosting.exportStatus,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          inArray(schema.GlPosting.id, glPostingIds)
        )
      )

    const byId = new Map(rows.map((row) => [row.id, row]))
    const outcomes: SyncReleaseOutcome[] = []

    for (const glPostingId of glPostingIds) {
      const row = byId.get(glPostingId)
      if (!row) {
        outcomes.push({ glPostingId, docNumber: null, status: 'error', message: 'Not found.' })
        continue
      }
      const base = { glPostingId, docNumber: row.docNumber }

      if (row.exportStatus === 'exported') {
        // Not an error. Two people clearing the same queue should both be told
        // it is in the books, not one of them handed a refusal for being second.
        outcomes.push({ ...base, status: 'exported' })
        continue
      }
      if (row.exportStatus === 'not_required') {
        outcomes.push({
          ...base,
          status: 'skipped',
          message: `${row.docNumber} is not exported: nothing is connected, pushing is switched off, or this kind of entry is never sent.`,
        })
        continue
      }

      try {
        const planned = await db.transaction((tx) =>
          planAccountingDeliveryInTx(tx, { organizationId, glPostingId, manual: true })
        )
        if (!planned) {
          outcomes.push({
            ...base,
            status: 'skipped',
            message: `${row.docNumber} has no external destination, so there is nothing to sync it to.`,
          })
          continue
        }
        await enqueueAccountingDelivery({ organizationId, glPostingId })
        outcomes.push({ ...base, status: 'released' })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn('Could not release a posting for sync', { organizationId, glPostingId, reason })
        outcomes.push({ ...base, status: 'error', message: reason })
      }
    }

    const result: SyncReleaseResult = {
      released: outcomes.filter((o) => o.status === 'released').length,
      skipped: outcomes.filter((o) => o.status === 'skipped' || o.status === 'exported').length,
      failed: outcomes.filter((o) => o.status === 'error').length,
      outcomes,
    }
    logger.info('Released postings for sync', { organizationId, ...result, outcomes: undefined })
    return ok(result)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('Releasing postings for sync failed', { organizationId, error: reason })
    return err(error instanceof Error ? error : new Error(reason))
  }
}
