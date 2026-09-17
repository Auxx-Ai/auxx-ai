// packages/lib/src/postings/insert-posting.ts
import { schema, type Transaction } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ConflictError } from '../errors'
import {
  buildPostingDraft,
  type PostingAccountingMembership,
  type PostingAssertions,
} from './draft'
import { LEDGER_CURRENCY } from './ledger-currency'
import { releaseReversedPostingClaimsInTx } from './release-claims'
import type { BuiltEntry, PostingExportStatus, ResolvedPostingLine } from './types'

/** Destination already pinned under the accounting transaction lock. */
export type PostingDeliveryIntent =
  | { kind: 'not_required' }
  | { kind: 'manual' | 'automatic'; connectionId: string }

/** One line after resolution, paired with the role it was resolved FROM. */
export interface PreparedLine {
  /**
   * The role the builder emitted. Stored on the `GlPostingLine` row (decision
   * G8) so a posted line can still answer "which account was this SUPPOSED to
   * be" after the chart is renumbered - and never handed to a provider.
   *
   * `null` on a CODE line (a manual or opening entry), because there is no role
   * to record: the human named the account itself. `GlPostingLine.accountRole`
   * is nullable for exactly this, and `read-posting.ts` already reads it back as
   * `string | null`.
   */
  accountRole: string | null
  resolved: ResolvedPostingLine
}

export type ClaimOutcome =
  | { kind: 'claimed'; row: { id: string; docNumber: string; requestId: string } }
  | {
      kind: 'existing'
      row: {
        id: string
        docNumber: string
        status: string
        exportStatus: PostingExportStatus
        providerId: string | null
        providerEntryId: string | null
        draft: unknown
      }
    }

/** Shared commit-only header/line insertion; caller owns the transaction and accounting lock. */
export async function insertPostingInTx(
  tx: Transaction,
  input: {
    organizationId: string
    entry: BuiltEntry
    revision: number
    reversesId?: string
    docNumber: string
    requestId: string
    totalMinor: number
    lines: PreparedLine[]
    memo?: string
    actorUserId?: string
    assertions?: PostingAssertions
    deliveryIntent?: PostingDeliveryIntent
    accountingMembership?: PostingAccountingMembership
  }
): Promise<ClaimOutcome> {
  const { organizationId, entry, revision, reversesId, docNumber, requestId, totalMinor, lines } =
    input
  const claimed = await tx
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: entry.postingType,
      periodKey: entry.periodKey,
      revision,
      // 🛑 `posted` HERE, not after the provider answers. Every ledger-side
      // question is settled before this INSERT runs - the period lock (step
      // 1), the roles (2), the balance (3) - and the lines go in below in the
      // same transaction. There is no moment at which this row legitimately
      // exists un-posted, and stamping it later is what let an EXPORT fault
      // take an entry out of the books. See
      // plans/accounting/export-state-split.md.
      status: 'posted',
      // `GlPosting_posted_check` is `status <> 'posted' OR postedAt IS NOT
      // NULL`, so the timestamp is part of the same INSERT rather than a
      // later UPDATE.
      postedAt: new Date(),
      // The push has not run yet. `markExported` / `recordExportFailure`
      // move it, and NOTHING they do may touch `status`.
      exportStatus: input.deliveryIntent?.kind === 'not_required' ? 'not_required' : 'pending',
      txnDate: entry.txnDate,
      docNumber,
      // Explicit, never the column default - see LEDGER_CURRENCY.
      currency: LEDGER_CURRENCY,
      deliveryIntent: input.deliveryIntent?.kind ?? null,
      intendedBookConnectionId:
        input.deliveryIntent && input.deliveryIntent.kind !== 'not_required'
          ? input.deliveryIntent.connectionId
          : null,
      totalMinor,
      // The audit record of WHAT WAS POSTED. The built entry verbatim PLUS
      // the resolved lines, not a hint for reconstructing them: rebuilding
      // from the subledger later gives a different answer once the subledger
      // moves, which is the one property a ledger must not have.
      // One construction site, in `draft.ts`, because this shape is no longer
      // written-and-never-read: the L1 month-end reader reads the previous
      // month's envelope to learn what balance was last asserted.
      draft: buildPostingDraft({
        docNumber,
        revision,
        memo: input.memo,
        entry,
        resolvedLines: lines.map((line) => ({
          accountRole: line.accountRole,
          ...line.resolved,
        })),
        assertions: input.assertions,
        // The builder's per-line "why", frozen beside `sources` (brief 28
        // §5). Only builders with a fork emit one; everything else is absent.
        reasons: entry.reasons,
        accountingMembership: input.accountingMembership,
      }),
      requestId,
      // A reversal names its original in the INSERT. `GlPosting_reversal_check`
      // makes inserting-then-linking impossible.
      reversesId: reversesId ?? null,
      // Who claimed is who posted: decision G5's trigger is a person clicking
      // Post, synchronously, and recording the actor now keeps the attribution
      // even if the push then fails.
      postedByUserId: input.actorUserId ?? null,
    })
    .onConflictDoNothing({
      target: [
        schema.GlPosting.organizationId,
        schema.GlPosting.postingType,
        schema.GlPosting.periodKey,
        schema.GlPosting.revision,
      ],
    })
    .returning({
      id: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
      requestId: schema.GlPosting.requestId,
    })

  const row = claimed[0]
  if (!row) {
    // Someone owns the period. Under genuine concurrency this statement
    // BLOCKED on the winner's uncommitted index tuple and resumed once it
    // committed, so the row is visible to this read.
    const existing = await tx
      .select({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        status: schema.GlPosting.status,
        exportStatus: schema.GlPosting.exportStatus,
        providerId: schema.GlPosting.providerId,
        providerEntryId: schema.GlPosting.providerEntryId,
        draft: schema.GlPosting.draft,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.postingType, entry.postingType),
          eq(schema.GlPosting.periodKey, entry.periodKey),
          eq(schema.GlPosting.revision, revision)
        )
      )
      .limit(1)

    const found = existing[0]
    if (!found) {
      // The insert wrote nothing and the read found nothing. That is not a
      // conflict, it is a broken claim, and swallowing it would report a
      // double-post defence that is not running.
      throw new Error(
        `Claim for ${docNumber} returned no row and no conflicting posting exists. ` +
          'The ON CONFLICT target may no longer match GlPosting_org_type_period_revision_key.'
      )
    }
    return { kind: 'existing', row: found }
  }

  if (lines.length > 0) {
    await tx.insert(schema.GlPostingLine).values(
      lines.map((line, index) => ({
        organizationId,
        glPostingId: row.id,
        // 1-based and derived from the built order, which `prepareEntry`
        // sorted by `sortOrder`. Unique per posting
        // (`GlPostingLine_posting_lineNumber_key`).
        lineNumber: index + 1,
        glAccountId: line.resolved.glAccountId,
        accountCode: line.resolved.accountCode,
        accountRole: line.accountRole,
        accountName: line.resolved.accountName ?? null,
        direction: line.resolved.direction,
        amountMinor: line.resolved.amount,
        memo: line.resolved.memo ?? null,
        sourceType: line.resolved.sourceType,
        sourceId: line.resolved.sourceId,
        // FROZEN here (brief 13 §1.1): a retry replays this column, never a
        // re-resolve, so an entry booked under one counterparty stays under
        // it even if the record is later merged or renamed.
        counterpartyType: line.resolved.counterpartyType ?? null,
        counterpartyId: line.resolved.counterpartyId ?? null,
        // Reporting dimensions (brief 13 §5) - `{ channel: 'dealer' }` and
        // the like. Never a lookup key, never resolved, just stored.
        dimensions: line.resolved.dimensions ?? null,
      }))
    )
  }

  // 🛑 The original flips to `reversed` HERE, in the claim transaction, not
  // when the reversal's export succeeds. The reversal is `posted` the moment
  // this transaction commits, so an original left `posted` alongside it would
  // be double-counted by every report until a push that may never succeed
  // says otherwise. Guarded on `posted` so a second reversal of the same
  // entry cannot re-flip a row that has already moved.
  if (reversesId) {
    const [original] = await tx
      .select()
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.id, reversesId),
          eq(schema.GlPosting.organizationId, organizationId)
        )
      )
      .for('update')
    if (
      !original ||
      original.status !== 'posted' ||
      original.postingType !== entry.postingType ||
      original.periodKey !== entry.periodKey ||
      original.revision + 1 !== revision
    ) {
      throw new ConflictError('The posting to reverse changed; reload before reversing')
    }
    // R2/R3 (brief 62): a reversal is an undo, not a correction - it releases
    // the original's claim so its work returns to `pending` and can be posted
    // again, rather than refusing to reverse an effect-backed row at all.
    await releaseReversedPostingClaimsInTx(tx, organizationId, {
      id: original.id,
      docNumber: original.docNumber,
      exportStatus: original.exportStatus,
    })
    await tx
      .update(schema.GlPosting)
      .set({ status: 'reversed' })
      .where(
        and(
          eq(schema.GlPosting.id, reversesId),
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.status, 'posted')
        )
      )
  }

  return { kind: 'claimed', row }
}
