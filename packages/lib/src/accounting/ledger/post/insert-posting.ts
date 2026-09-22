// packages/lib/src/accounting/ledger/post/insert-posting.ts
//
// The row write, and the claim. `post-entry.ts` owns the order of operations;
// this file owns the SQL.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { ConflictError } from '../../../errors'
import { avenueOfPostingType } from '../setup/export-settings'
import { LEDGER_CURRENCY } from '../setup/ledger-currency'
import type { BuiltEntry, GlPostingSourceInput, ResolvedPostingLine } from '../types'
import { buildPostingDraft, type PostingAssertions } from './draft'

/** One line after resolution, paired with the role it was resolved FROM. */
export interface PreparedLine {
  /**
   * The role the builder emitted. Stored on the `GlPostingLine` row (decision
   * G8) so a posted line can still answer "which account was this SUPPOSED to
   * be" after the chart is renumbered - and never handed to a provider.
   *
   * `null` on a CODE line (a manual or opening entry), because there is no role
   * to record.
   */
  accountRole: string | null
  resolved: ResolvedPostingLine
}

/** The posting that holds a claim, as the loser of a race reads it. */
export interface ClaimHolderRow {
  id: string
  docNumber: string | null
  status: string
  built: unknown
}

export type ClaimOutcome =
  | { kind: 'claimed'; row: { id: string; docNumber: string | null } }
  | { kind: 'existing'; row: ClaimHolderRow }

export interface InsertPostingInput {
  organizationId: string
  entry: BuiltEntry
  revision: number
  reversesId?: string
  /** NULL for a draft: a draft holds no claim and gets no number until it posts. */
  docNumber: string | null
  totalMinor: number
  lines: PreparedLine[]
  /** At least one `subject`. The subject row is the claim; see {@link claimSubjectInTx}. */
  sources: GlPostingSourceInput[]
  storeId?: string | null
  railId?: string | null
  /** The provider's payout id; null until brief 94 stamps it. */
  payoutId?: string | null
  memo?: string
  actorUserId?: string
  assertions?: PostingAssertions
  status: 'draft' | 'posted'
}

/** The one subject row of a source set. Throws if there is not exactly one. */
export function subjectOf(sources: GlPostingSourceInput[]): GlPostingSourceInput {
  const subjects = sources.filter((source) => source.linkRole === 'subject')
  const subject = subjects[0]
  if (!subject || subjects.length > 1) {
    throw new ConflictError(
      `A posting needs exactly one subject source, got ${subjects.length}. ` +
        'The subject row is the claim that makes a double post unrepresentable.'
    )
  }
  return subject
}

/**
 * Take the claim: insert the subject row, `ON CONFLICT DO NOTHING RETURNING`.
 *
 * 🛑 This IS the double-post defence. Two concurrent posts of one source contend
 * on `GlPostingSource_claim_key`; the loser gets no row back, reads the winner's
 * posting and returns `already_posted`. Nothing about that depends on a
 * provider, on a network, or on our own code getting the ordering right.
 *
 * Returns the id of the posting that holds the claim, or `null` when this
 * transaction took it.
 */
export async function claimSubjectInTx(
  tx: Transaction,
  input: { organizationId: string; glPostingId: string; subject: GlPostingSourceInput }
): Promise<{ heldBy: string } | null> {
  const { organizationId, glPostingId, subject } = input
  const claimed = await tx
    .insert(schema.GlPostingSource)
    .values({
      organizationId,
      glPostingId,
      sourceKind: subject.sourceKind,
      sourceId: subject.sourceId,
      linkRole: 'subject',
      occurrence: subject.occurrence ?? 'original',
    })
    .onConflictDoNothing()
    .returning({ id: schema.GlPostingSource.id })

  if (claimed[0]) return null

  const [winner] = await tx
    .select({ glPostingId: schema.GlPostingSource.glPostingId })
    .from(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, subject.sourceKind),
        eq(schema.GlPostingSource.sourceId, subject.sourceId),
        eq(schema.GlPostingSource.occurrence, subject.occurrence ?? 'original'),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )
    .limit(1)

  if (!winner) {
    // The insert wrote nothing and the read found nothing. Not a conflict: a
    // broken claim, and swallowing it reports a defence that is not running.
    throw new Error(
      `Claim for ${subject.sourceKind}:${subject.sourceId} returned no row and no conflicting ` +
        'subject exists. GlPostingSource_claim_key may no longer match.'
    )
  }
  return { heldBy: winner.glPostingId }
}

/**
 * Write the links. A posted entry's subject went in through
 * {@link claimSubjectInTx}; a draft's subject is written as `pending`, so the
 * record it is about can find it without the draft holding a claim.
 */
export async function insertSourceLinksInTx(
  tx: Database | Transaction,
  input: {
    organizationId: string
    glPostingId: string
    sources: GlPostingSourceInput[]
    mode: 'draft' | 'post'
  }
): Promise<void> {
  const rows = input.sources
    .filter((source) => source.linkRole !== 'subject' || input.mode === 'draft')
    .map((source) => ({
      organizationId: input.organizationId,
      glPostingId: input.glPostingId,
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      linkRole: source.linkRole === 'subject' ? ('pending' as const) : source.linkRole,
      occurrence: source.occurrence ?? 'original',
    }))
  if (rows.length > 0) await tx.insert(schema.GlPostingSource).values(rows)
}

/** Drop a draft's `pending` row - the claim replaces it, or the draft is discarded. */
export async function releasePendingInTx(
  tx: Transaction,
  input: { organizationId: string; glPostingId: string }
): Promise<void> {
  await tx
    .delete(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, input.organizationId),
        eq(schema.GlPostingSource.glPostingId, input.glPostingId),
        eq(schema.GlPostingSource.linkRole, 'pending')
      )
    )
}

/**
 * Write the header and its lines. Caller owns the transaction, the accounting
 * lock and the claim.
 *
 * A `draft` row carries lines, `built` and its source links, and no doc number:
 * posting assigns both the number and the claim (`postDraft`).
 */
export async function insertPostingInTx(
  tx: Transaction,
  input: InsertPostingInput
): Promise<{ id: string; docNumber: string | null }> {
  const { organizationId, entry, revision, reversesId, docNumber, totalMinor, lines } = input
  const posted = input.status === 'posted'

  const [row] = await tx
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: entry.postingType,
      avenue: avenueOfPostingType(entry.postingType),
      periodKey: entry.periodKey,
      revision,
      status: input.status,
      // `GlPosting_posted_check` is `status <> 'posted' OR postedAt IS NOT NULL`,
      // so the timestamp is part of the same INSERT rather than a later UPDATE.
      postedAt: posted ? new Date() : null,
      txnDate: entry.txnDate,
      docNumber,
      storeId: input.storeId ?? null,
      railId: input.railId ?? null,
      payoutId: input.payoutId ?? null,
      // Explicit, never the column default - see LEDGER_CURRENCY.
      currency: LEDGER_CURRENCY,
      totalMinor,
      // The audit record of WHAT WAS POSTED, verbatim. One construction site,
      // in `draft.ts`.
      built: buildPostingDraft({
        docNumber: docNumber ?? '',
        revision,
        memo: input.memo,
        entry,
        resolvedLines: lines.map((line) => ({ accountRole: line.accountRole, ...line.resolved })),
        assertions: input.assertions,
        reasons: entry.reasons,
        sources: input.sources,
      }),
      // A reversal names its original in the INSERT. `GlPosting_reversal_check`
      // makes inserting-then-linking impossible.
      reversesId: reversesId ?? null,
      postedByUserId: input.actorUserId ?? null,
    })
    .returning({
      id: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
    })

  if (!row) throw new Error('GlPosting insert returned no row')

  if (lines.length > 0) {
    await tx.insert(schema.GlPostingLine).values(toLineRows(organizationId, row.id, lines))
  }

  return row
}

/**
 * The `GlPostingLine` values for a prepared entry - the first insert and a
 * draft's re-insert must write the same columns or an edited draft would post
 * differently from a fresh one.
 *
 * `lineNumber` is 1-based over the built order, which `prepareEntry` sorted by
 * `sortOrder`. `counterparty*` is FROZEN here (brief 13 §1.1): a retry replays
 * the column rather than re-resolving it.
 */
export function toLineRows(
  organizationId: string,
  glPostingId: string,
  lines: readonly PreparedLine[]
) {
  return lines.map((line, index) => ({
    organizationId,
    glPostingId,
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
    counterpartyType: line.resolved.counterpartyType ?? null,
    counterpartyId: line.resolved.counterpartyId ?? null,
    dimensions: line.resolved.dimensions ?? null,
  }))
}

/**
 * Flip the original of a reversal to `reversed` and release its claim.
 *
 * 🛑 The flip happens in the reversal's OWN transaction, not when its export
 * succeeds: the reversal is `posted` the moment that transaction commits, so an
 * original left `posted` beside it would be double-counted by every report.
 *
 * Deleting the original's subject rows is what lets the source post again - a
 * reversal is an undo, not a correction (TARGET §1).
 */
export async function markReversedInTx(
  tx: Transaction,
  input: {
    organizationId: string
    reversesId: string
    entry: BuiltEntry
    revision: number
  }
): Promise<void> {
  const { organizationId, reversesId, entry, revision } = input
  const [original] = await tx
    .select()
    .from(schema.GlPosting)
    .where(
      and(eq(schema.GlPosting.id, reversesId), eq(schema.GlPosting.organizationId, organizationId))
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

  await tx
    .delete(schema.GlPostingSource)
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.glPostingId, reversesId),
        eq(schema.GlPostingSource.linkRole, 'subject')
      )
    )

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

/** Read the row that holds a claim, for the `already_posted` answer. */
export async function readClaimHolderInTx(
  tx: Transaction,
  input: { organizationId: string; glPostingId: string }
): Promise<ClaimHolderRow> {
  const [found] = await tx
    .select({
      id: schema.GlPosting.id,
      docNumber: schema.GlPosting.docNumber,
      status: schema.GlPosting.status,
      built: schema.GlPosting.built,
    })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.id, input.glPostingId),
        eq(schema.GlPosting.organizationId, input.organizationId)
      )
    )
    .limit(1)

  if (!found) {
    throw new Error(`The claim names posting ${input.glPostingId}, which does not exist.`)
  }
  return found
}

/** Assign the doc number and flip a draft to `posted`, in the claim's transaction. */
export async function markPostedInTx(
  tx: Transaction,
  input: {
    organizationId: string
    glPostingId: string
    docNumber: string
    actorUserId?: string
  }
): Promise<void> {
  await tx
    .update(schema.GlPosting)
    .set({
      status: 'posted',
      postedAt: new Date(),
      docNumber: input.docNumber,
      ...(input.actorUserId ? { postedByUserId: input.actorUserId } : {}),
      built: sql`jsonb_set(${schema.GlPosting.built}, '{docNumber}', ${JSON.stringify(input.docNumber)}::jsonb)`,
    })
    .where(
      and(
        eq(schema.GlPosting.id, input.glPostingId),
        eq(schema.GlPosting.organizationId, input.organizationId),
        eq(schema.GlPosting.status, 'draft')
      )
    )
}
