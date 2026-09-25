// packages/lib/src/accounting/ledger/post/reverse-entry.ts
//
// Backing an entry out (decision G4).
//
// A reversal is **a second, opposite entry with its own `GlPosting` row**. It is
// not an edit and it is not a delete:
//
//  - There is no `void` on a line-carrying journal entry at the providers we
//    export to, and a sparse update on one is how an entry silently unbalances.
//  - `GlPostingLine` has no `updatedAt` and no update path. Immutability there
//    is structural, exactly as `stock_movement` is corrected by `reverseMovement`
//    rather than edited.
//  - A period that has been posted never changes shape. What changes is that a
//    second entry lands against it, and the original's status becomes
//    `reversed`.
//
// The pair is distinguished by `revision`, NOT by a suffix on `periodKey`.
// gap-e §9 specified `'2026-08:rev'`; `parsePeriodKey` throws `BadRequestError`
// on it, so the module that owns the keyspace rejects the key the design asked
// for. `GlPosting.revision` is the shipped answer and `buildDocNumber` renders
// it as the `-R<revision>` suffix that keeps `GlPosting_org_docNumber_key`
// satisfiable.
//
// The original's subject claim is DELETED in the reversal's transaction, so its
// source can post again (TARGET §1). The reversal writes its own subject row,
// `(gl_posting, <original id>, occurrence 'reversal')`.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { canReverseExportedPosting } from '../../export/client'
import { buildEntry } from '../builders/entry'
import { readPostingHeader } from '../reads/read-posting'
import type { ExportAvenue } from '../setup/export-settings'
import type {
  CounterpartyType,
  GlPostingLineInput,
  GlPostingSourceInput,
  PostingType,
  PostResult,
  ReverseManyResult,
  ReverseOutcome,
} from '../types'
import { withAccountingCommitLock } from './accounting-commit-lock'
import { readDraftReasons, reverseAssertions } from './draft'
import { didLedgerAccept } from './ledger-accepted'
import { exportPostedEntry, type InTxPostResult, postEntryInTx } from './post-entry'

const logger = createScopedLogger('postings:reverse-entry')

export interface ReverseEntryOptions {
  organizationId: string
  /** The `GlPosting` row to back out. It must be `posted`. */
  glPostingId: string
  actorUserId?: string
  memo?: string
  /** The person's Reverse: refused until the provider holds the entry. Undo paths leave it off. */
  onlyIfExported?: boolean
  /** Extra non-subject links on the reversal, e.g. what the correction was made for. */
  links?: GlPostingSourceInput[]
}

/** A refusal, in the same shape `postEntry` returns. This function never throws either. */
function refuse(error: string, glPostingId?: string): PostResult {
  return { status: 'error', failureClass: 'data', retryable: false, error, glPostingId }
}

/**
 * Post the opposite of an existing entry.
 *
 * **Never throws.** Every refusal is a {@link PostResult}, like `postEntry`.
 *
 * The reversal claims `(organizationId, postingType, periodKey, revision + 1)`
 * with `reversesId` in its INSERT - `GlPosting_reversal_check` makes
 * inserting-then-linking impossible - and `postEntry` flips the original to
 * `reversed` inside the same transaction that marks the reversal `posted`.
 *
 * 🛑 **The original provider entry is not touched.** Nothing is voided, nothing
 * is updated. The provider's register ends up holding both halves, which is
 * what a bookkeeper expects to see and what makes the pair auditable.
 *
 * ## Why this reverses by `glAccountId`, not by role or code
 *
 * A reversal must land on the SAME account as the entry it backs out. Before
 * task 15, this rebuilt a role line as `{ accountRole }` and re-resolved it
 * against the CURRENT chart, so a role remapped between the post and the
 * reversal (`grni` from `2160` to `2155`, say) credited `2155` and left `2160`
 * overstated forever - and both entries still balanced, so nothing downstream
 * could detect it.
 *
 * `glAccountId` is the IDENTITY (`GlPostingLineInput`'s third variant,
 * plans/accounting/tasks/done/15-the-account-id-is-the-identity.md), and every
 * reversed line is built from the original's stored id rather than its role or
 * code. `resolveAccountLines` still validates the id against the org's chart -
 * archived reads as missing, inactive refuses - so a reversal fails closed the
 * same way a post does; it simply can no longer drift to a DIFFERENT account
 * than the one it is backing out. The original's `accountRole` is copied onto
 * the reversed line as the snapshot it is, so the pair reads the same way in
 * the journal.
 */
export async function reverseEntry(
  db: Database,
  options: ReverseEntryOptions
): Promise<PostResult> {
  try {
    const result = await db.transaction(async (tx) => {
      await withAccountingCommitLock(tx, options.organizationId)
      return reverseEntryInTx(tx, options)
    })
    const { pendingExport, ...reversed } = result
    if (!pendingExport) return reversed
    return exportPostedEntry(db, pendingExport)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Reversal failed', {
      organizationId: options.organizationId,
      glPostingId: options.glPostingId,
      error: message,
    })
    return { status: 'error', failureClass: 'transport', retryable: false, error: message }
  }
}

/**
 * {@link reverseEntry} on the caller's transaction, so an undo and the record
 * change that motivated it commit or roll back together.
 *
 * Throws rather than swallowing - see {@link postEntryInTx}. A `Database` is
 * accepted too, which is how `reverseEntry` reuses it.
 */
export async function reverseEntryInTx(
  tx: Transaction,
  options: ReverseEntryOptions
): Promise<InTxPostResult> {
  const { organizationId, glPostingId, actorUserId, memo, onlyIfExported, links } = options

  {
    const db = tx
    const original = await readPostingHeader(db, organizationId, glPostingId)

    if (!original) {
      return refuse(`No posting ${glPostingId} in this organization.`)
    }

    // Only a `posted` entry has anything to back out. `pending` is claimed but
    // in flight - reversing it would leave a reversal of something the provider
    // may still be about to accept. `failed` never reached the ledger.
    // `reversed` has been backed out already, and a second reversal would
    // double the correction.
    if (original.status !== 'posted') {
      return refuse(
        `Posting ${original.docNumber} is ${original.status}, not posted. ` +
          'Only a posted entry can be reversed.',
        original.id
      )
    }

    if (onlyIfExported && !(await isExportedOrLocal(db, organizationId, original.id))) {
      return refuse(
        `Posting ${original.docNumber} has not been sent to the provider yet. ` +
          'Only an entry the provider holds can be reversed.',
        original.id
      )
    }

    const lines = await db
      .select({
        lineNumber: schema.GlPostingLine.lineNumber,
        glAccountId: schema.GlPostingLine.glAccountId,
        // The role SNAPSHOT, copied onto the reversed line; the id decides the account.
        accountRole: schema.GlPostingLine.accountRole,
        direction: schema.GlPostingLine.direction,
        amountMinor: schema.GlPostingLine.amountMinor,
        memo: schema.GlPostingLine.memo,
        sourceType: schema.GlPostingLine.sourceType,
        sourceId: schema.GlPostingLine.sourceId,
        // Carried onto the reversed line unchanged (brief 13 §1.1): the
        // reversal backs the SAME receivable or payable out of the SAME
        // counterparty's balance, so it must name the counterparty the
        // original did, not one re-resolved today.
        counterpartyType: schema.GlPostingLine.counterpartyType,
        counterpartyId: schema.GlPostingLine.counterpartyId,
        // Carried onto the reversed line unchanged too (brief 13 §5): the
        // reversal is reporting-wise the same line as the original, backwards.
        dimensions: schema.GlPostingLine.dimensions,
      })
      .from(schema.GlPostingLine)
      .where(
        and(
          eq(schema.GlPostingLine.glPostingId, original.id),
          eq(schema.GlPostingLine.organizationId, organizationId)
        )
      )
      .orderBy(asc(schema.GlPostingLine.lineNumber))

    if (lines.length === 0) {
      return refuse(
        `Posting ${original.docNumber} has no lines. There is nothing to reverse.`,
        original.id
      )
    }

    // ── The opposite entry ─────────────────────────────────────────────────
    // Same accounts, same amounts, same audit pair, flipped direction. Built
    // through `buildEntry` so the reversal is subject to the same balance and
    // minor-unit assertions as anything else that reaches the ledger.
    //
    // Every line reverses by `glAccountId` - the IDENTITY - not by the role or
    // code it was originally coded with. `resolveAccountLines` still validates
    // the id against the org's live chart (archived reads as missing, inactive
    // refuses), so this fails closed exactly as a role or code line would; it
    // just cannot land on a DIFFERENT account than the one it is backing out.
    //
    // The role rides along as a SNAPSHOT only (the id variant allows it for
    // exactly this): the reversal's stored line says which account it was
    // SUPPOSED to be, the same way the original's does, while the id alone
    // decides where it lands.
    const reversedLines: GlPostingLineInput[] = lines.map((line, index) => ({
      glAccountId: line.glAccountId,
      accountRole: line.accountRole ?? undefined,
      direction: line.direction === 'debit' ? 'credit' : 'debit',
      amount: line.amountMinor,
      memo: line.memo ?? undefined,
      // The source pair is carried through unchanged: "what did this movement
      // post to" must find both halves of the pair, not just the original.
      sourceType: line.sourceType,
      sourceId: line.sourceId,
      sortOrder: index,
      // The counterparty rides along unchanged too (brief 13 §1.1): the
      // reversal is the SAME receivable or payable, backed out of the SAME
      // customer or vendor's balance.
      counterpartyType: (line.counterpartyType as CounterpartyType | null) ?? undefined,
      counterpartyId: line.counterpartyId ?? undefined,
      // And the dimensions ride along too (brief 13 §5): the reversal is
      // reporting-wise the same line as the original, backwards.
      dimensions: (line.dimensions as Record<string, string> | null) ?? undefined,
    }))

    const built = buildEntry({
      postingType: original.postingType as PostingType,
      // The SAME period. `revision` is what distinguishes the pair; the period
      // key is the claim's third column and must not move, or the reversal
      // would claim a period of its own.
      periodKey: original.periodKey,
      // The SAME accounting date. A reversal backs the original out of the
      // balances it moved, which are the balances of its own date.
      txnDate: original.txnDate,
      lines: reversedLines,
    })

    // ── The reasons, verbatim ──────────────────────────────────────────────
    // The original's per-line "why" (brief 28 §5) is copied unchanged: the
    // reversed lines were built in `lineNumber` order with `sortOrder: index`,
    // so line N of the reversal backs out line N of the original and the same
    // sentence explains both. The drawer prefixes it with "Reversing:". Read
    // leniently - an envelope without the field is an ordinary older entry.
    const reasons = readDraftReasons(original.built)
    const entry = reasons ? { ...built, reasons } : built

    // ── The assertions, swapped ────────────────────────────────────────────
    // A posting that ASSERTS a balance (month-end inventory) records the state
    // on either side of itself. Its reversal asserts the same pair the other way
    // round, so the next period's prior-row read lands on the state that existed
    // before the original - and reversing the reversal swaps back.
    //
    // 🛑 Read from the FROZEN draft, never recomputed from today's subledger.
    // Re-running the month-end reader here would pick up movements that arrived
    // after the original posted, and the reversal would assert figures unrelated
    // to the lines it is backing out.
    //
    // Parsed ONLY for a type that requires assertions. A receipt or vendor-bill
    // posting has none to carry, so its draft is irrelevant to the reversal -
    // and `parsePostingDraft` is strict on purpose, so parsing one anyway would
    // let an old or hand-written envelope block a reversal that does not depend
    // on it. Where assertions ARE required, a draft that will not parse is
    // fatal: writing the reversal without them would silently break the chain
    // the next close reads its opening figures from.
    // Only an entry that CARRIES assertions swaps them. Nothing writes them any
    // more, so this is the historical path, and `parsePostingDraft` is strict
    // enough that parsing an envelope the reversal does not depend on would let
    // an old row block its own correction.
    const originalAssertions = undefined

    logger.info('Reversing posting', {
      organizationId,
      glPostingId: original.id,
      docNumber: original.docNumber,
      revision: original.revision + 1,
      lineCount: reversedLines.length,
    })

    return postEntryInTx(tx, {
      organizationId,
      entry,
      assertions: originalAssertions ? reverseAssertions(originalAssertions) : undefined,
      actorUserId,
      memo: memo ?? `Reversal of ${original.docNumber}`,
      reversesId: original.id,
      revision: original.revision + 1,
      docNumber: original.docNumber ? `${original.docNumber}-R${original.revision + 1}` : undefined,
      storeId: original.storeId,
      railId: original.railId,
      // The reversal's OWN subject. `markReversedInTx` deletes the original's
      // subject rows in the same transaction, which is what frees the source.
      sources: [
        {
          sourceKind: 'gl_posting',
          sourceId: original.id,
          linkRole: 'subject',
          occurrence: 'reversal',
        },
        ...(links ?? []).filter((link) => link.linkRole !== 'subject'),
      ],
    })
  }
}

/** {@link canReverseExportedPosting} against the posting's avenue and its live batch. */
async function isExportedOrLocal(
  tx: Transaction,
  organizationId: string,
  glPostingId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ avenue: schema.GlPosting.avenue, exportState: schema.ExportBatch.state })
    .from(schema.GlPosting)
    .leftJoin(
      schema.ExportBatchPosting,
      and(
        eq(schema.ExportBatchPosting.organizationId, schema.GlPosting.organizationId),
        eq(schema.ExportBatchPosting.glPostingId, schema.GlPosting.id),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
    .leftJoin(
      schema.ExportBatch,
      and(
        eq(schema.ExportBatch.organizationId, schema.ExportBatchPosting.organizationId),
        eq(schema.ExportBatch.id, schema.ExportBatchPosting.batchId)
      )
    )
    .where(
      and(eq(schema.GlPosting.organizationId, organizationId), eq(schema.GlPosting.id, glPostingId))
    )
  if (!row) return false
  return canReverseExportedPosting({
    avenue: row.avenue as ExportAvenue | null,
    exportState: row.exportState ?? null,
  })
}

export interface ReverseEntriesOptions {
  organizationId: string
  glPostingIds: string[]
  actorUserId?: string
  memo?: string
  onlyIfExported?: boolean
}

/**
 * Reverse several entries, one outcome per posting.
 *
 * Shaped on `unsyncExports`: de-duped, **never throws**, and the tallies are
 * re-counted off the outcome array rather than incremented as it goes.
 *
 * 🛑 One entry at a time, deliberately sequential. Each reversal is a full
 * `postEntry` - it claims `(postingType, periodKey, revision + 1)`, resolves
 * accounts against the chart and writes its effects - and a batch transaction
 * around forty of them would hold the commit lock for the length of the slowest.
 * A row that refuses lands the rest, which is the whole point of the shape.
 */
export async function reverseEntries(
  db: Database,
  options: ReverseEntriesOptions
): Promise<ReverseManyResult> {
  const { organizationId, actorUserId, memo, onlyIfExported } = options
  const glPostingIds = [...new Set(options.glPostingIds)]

  const outcomes: ReverseOutcome[] = []
  for (const glPostingId of glPostingIds) {
    const result = await reverseEntry(db, {
      organizationId,
      glPostingId,
      actorUserId,
      memo,
      onlyIfExported,
    })
    outcomes.push({
      glPostingId,
      docNumber: result.docNumber ?? null,
      status: didLedgerAccept(result) ? 'reversed' : 'refused',
      message: didLedgerAccept(result) ? undefined : (result.error ?? 'It was not reversed.'),
    })
  }

  return {
    reversed: outcomes.filter((outcome) => outcome.status === 'reversed').length,
    refused: outcomes.filter((outcome) => outcome.status === 'refused').length,
    outcomes,
  }
}
