// packages/lib/src/banking/review/writes.ts

/**
 * The four treatments a reviewer can apply to a bank line, plus undo
 * (plans/bank-connection/03-categorization-and-gl.md §3, HANDOFF slot 3B).
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerView` or `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## 🛑 Only ONE of the four posts
 *
 * | Treatment | Ledger |
 * |---|---|
 * | **Match** | **Nothing.** It links to a document that already posted (**B5**) |
 * | **Code** | One entry - `Dr <code> / Cr <bank account>` |
 * | **Transfer** | One entry, cash to cash, filed on the outgoing leg |
 * | **Exclude** | Nothing |
 *
 * The match row is the most important line in this file. `buildPaymentEntry`
 * and the bill-payment builder already credit cash for the event the bank line
 * corroborates; a second entry from the feed credits cash TWICE, both entries
 * balance, the trial balance balances, and nothing detects it until a cash
 * account will not tie months later. A bank line's job on a document auxx
 * already holds is confirmation and dating, never posting.
 *
 * ## ⚠️ A `void` line refuses code and match
 *
 * `void` is the bank saying the transaction never happened. Coding one posts an
 * entry for an event with no money behind it; matching one marks a real document
 * confirmed by a line the bank has withdrawn. Both are refused by name. **Undo
 * is deliberately still allowed on a void line**, because the common case is a
 * line that was coded while pending and voided afterwards - and reversing that
 * posting is the whole remedy.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../errors'
import { clearBankDeposit } from '../../money/bank-deposits'
import { resolvePeriodLock } from '../../postings/period-lock'
import { postEntry } from '../../postings/post-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import type { PostResult } from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { pinPostedBankTransaction, unpinPostedBankTransaction } from '../feed/pins'
import { guard } from '../guard'
import { getBankAccount } from '../reads'
import { buildCodedBankEntry, buildTransferEntry } from './build-entry'
import {
  type BankTransactionRow,
  bankLineFlow,
  bankTransactionPeriodKey,
  CANDIDATE_DAY_WINDOW,
  MATCH_RECORD_TYPE_LABELS,
  type MatchRecordType,
  pickLinkableTransferLeg,
  pickOppositeLeg,
  type ReviewOutcome,
} from './client'
import {
  countBankTransactionPostings,
  listForReview,
  requireBankTransaction,
  requireReviewFieldContext,
} from './reads'

const logger = createScopedLogger('banking-review')

/** Every treatment carries the same two. */
interface ActorParams {
  organizationId: string
  actorUserId: string
  transactionId: string
}

/** The statuses that mean the ledger took the entry. Copied from `post-transaction.ts`. */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

// ── Match ───────────────────────────────────────────────────────────────────

export interface MatchTransactionInput extends ActorParams {
  recordType: MatchRecordType
  recordId: string
}

/**
 * Link a bank line to the document it corroborates. **Posts nothing.**
 *
 * Both directions are written, because a one-way link is a link that cannot be
 * audited from the document. The bank line gets `matchedRecordId` /
 * `matchedRecordType` and `reviewStatus: 'matched'`; the document gets whichever
 * of these it has:
 *
 * - `vendor_payment` - `bankTransactionId` and `clearedAt`.
 * - `bank_deposit` - through `clearBankDeposit`, never by writing its fields
 *   here: it is the writer that also flips the deposit to `cleared` and freezes
 *   it against edits, and a second writer would drift from it.
 * - `vendor_bill` - `paidSource: 'bank_import'`, which is the vocabulary that
 *   already exists for "a bank line confirmed this".
 * - `payment_transaction` - a `metadata` stamp. ⚠️ **A departure, reported.**
 *   Neither `PaymentTransaction` nor the `payment` entity has a bank-line
 *   column, so there is nowhere typed to put it; `metadata.bankImport` is the
 *   honest placeholder until a column lands, and the authoritative half of the
 *   link is the bank line's own `matchedRecordId`, which is queryable.
 *
 * 🛑 Refuses a document already matched to a DIFFERENT bank line, naming it. Two
 * bank lines pointing at one payment is a double count of the confirmation, and
 * the second one is the one that is really unreconciled.
 */
export async function matchTransaction(
  db: Database,
  input: MatchTransactionInput
): Promise<Result<ReviewOutcome, Error>> {
  const { organizationId, actorUserId, transactionId, recordType, recordId } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'matched')
      // 🛑 A line that already posted may not be re-labelled `matched`. Match
      // posts nothing, so the status would say "this line moved no money of its
      // own" while a live Dr 6100 / Cr 1010 entry stands behind it, and the
      // document it now points at credited the same cash a second time. The
      // remedy is the same one code and transfer name: undo first, which
      // REVERSES the entry, then match.
      assertNotPosted(line)

      if (recordType === 'bank_transaction') {
        throw new BadRequestError(
          'Two bank lines are matched to each other by the transfer treatment, not by a ' +
            'document match - a transfer also has to post the one cash-to-cash entry that a ' +
            'document match must never post.'
        )
      }
      if (line.matchedRecordId && line.matchedRecordId !== recordId) {
        throw new ConflictError(
          `This bank line is already matched to ${line.matchedRecordId}. Undo that first.`
        )
      }

      const existing = await readDocumentLink(db, organizationId, recordType, recordId)
      if (existing && existing !== transactionId) {
        throw new ConflictError(
          `${MATCH_RECORD_TYPE_LABELS[recordType]} ${recordId} is already matched to bank line ` +
            `${existing}. One document is confirmed by one bank line - undo that match first.`
        )
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
        bank_transaction_review_status: 'matched',
        bank_transaction_matched_record_id: recordId,
        bank_transaction_matched_record_type: recordType,
        bank_transaction_reviewed_at: new Date().toISOString(),
        bank_transaction_reviewed_by_user_id: actorUserId,
      })

      await stampDocument(db, {
        organizationId,
        actorUserId,
        recordType,
        recordId,
        transactionId,
      })

      logger.info('Matched a bank line to a document', {
        organizationId,
        transactionId,
        recordType,
        recordId,
      })
      return {
        transaction: await requireBankTransaction(db, organizationId, transactionId),
        // 🛑 Null, and it is the point of the treatment. See the file header.
        post: null,
        warnings: [],
      } satisfies ReviewOutcome
    },
    'Failed to match a bank line',
    { organizationId, transactionId, recordType, recordId }
  )
}

// ── Code ────────────────────────────────────────────────────────────────────

export interface CodeTransactionInput extends ActorParams {
  /** An account CODE from the org's own chart, e.g. `'6100'`. */
  glAccountCode: string
  /**
   * The vendor or customer this line is with.
   *
   * ⚠️ **Recorded in the entry's memo, not in a column.** `bank_transaction` has
   * no contact field - `matchedRecordId` is the polymorphic pointer at a
   * DOCUMENT, and writing a company id into it would make "what does this line
   * corroborate" answer "a vendor", which is not a document and not a match.
   * A real relationship field is owed; until it exists the honest place for the
   * name a person picked is the line memo, where it reaches the register.
   */
  contactRecordId?: string
  memo?: string
}

/**
 * Post `Dr <coded account> / Cr <bank account>` and stamp the line `coded`.
 *
 * The only treatment that creates an entry, and the only one where QuickBooks'
 * "category" idea applies at all: a bank fee, an interest charge, a card charge
 * nobody raised a bill for, an owner draw.
 *
 * Order of operations, and it matters: build, post, THEN stamp. A stamp written
 * before the post would leave a line reading `coded` with no posting behind it
 * when the period turns out to be locked - and a locked period is the ordinary
 * case at month end, not an exception.
 *
 * ⚠️ `postEntry` never throws, so a refusal arrives as a `PostResult` status on
 * the success path. The line is NOT stamped for a refused post, and the status
 * comes back for the drawer to render as an `EntryBlockers` card.
 */
export async function codeTransaction(
  db: Database,
  input: CodeTransactionInput
): Promise<Result<ReviewOutcome, Error>> {
  const { organizationId, actorUserId, transactionId, glAccountCode, memo } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'coded')
      assertNotPosted(line)
      const txnDate = requireTxnDate(line)

      // 🛑 A re-code after an undo must mint a DIFFERENT key. The reversed
      // original still holds the period tuple, and re-claiming it comes back
      // `already_posted` - a SUCCESS - which would stamp the line with the id of
      // the entry that was just backed out.
      const attempt = await countBankTransactionPostings(db, { organizationId, transactionId })
      const entry = buildCodedBankEntry({
        transactionId,
        periodKey: bankTransactionPeriodKey({
          transactionId,
          externalId: line.externalId,
          // 🛑 A bank's own id is unique per ACCOUNT, so the key has to carry
          // the account too - see `ACCOUNT_SCOPE_CHARS`.
          bankAccountId: line.bankAccountId,
          attempt,
        }),
        txnDate,
        amountMinor: line.amountMinor,
        glAccountCode,
        bankAccountCode: line.bankAccountCode ?? '',
        memo: memo ?? line.description ?? undefined,
      })
      if (input.contactRecordId) {
        for (const entryLine of entry.lines) {
          entryLine.memo = `${entryLine.memo ?? ''} (${input.contactRecordId})`.trim()
        }
      }

      const lock = await resolvePeriodLock(organizationId)
      const post = await postEntry(db, {
        organizationId,
        entry,
        actorUserId,
        lock,
        memo: memo ?? line.description ?? `Bank line ${line.externalId ?? transactionId}`,
      })

      if (!ACCEPTED_POST_STATUSES.has(post.status)) {
        logger.warn('A coded bank line was refused by the ledger', {
          organizationId,
          transactionId,
          status: post.status,
          error: post.error,
        })
        return {
          transaction: line,
          post: toPostSummary(post),
          warnings: [],
        } satisfies ReviewOutcome
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
        bank_transaction_review_status: 'coded',
        bank_transaction_gl_account: glAccountCode.trim(),
        bank_transaction_gl_posting_id: post.glPostingId ?? undefined,
        bank_transaction_reviewed_at: new Date().toISOString(),
        bank_transaction_reviewed_by_user_id: actorUserId,
      })

      // 🛑 After the post, never before: a pin on a row whose entry was refused
      // would freeze the feed out of a line it still owns. Slot 3A's function -
      // a no-op on a manual or imported row, which has no feed to be protected
      // from and is the ordinary case today.
      const pinned = line.bankAccountConnectorId
        ? await pinPostedBankTransaction(db, {
            organizationId,
            bankTransactionId: transactionId,
            connectorId: line.bankAccountConnectorId,
          })
        : 0

      logger.info('Coded a bank line', {
        organizationId,
        transactionId,
        glAccountCode,
        docNumber: post.docNumber,
        pinnedCells: pinned,
      })
      return {
        transaction: await requireBankTransaction(db, organizationId, transactionId),
        post: toPostSummary(post),
        warnings: [],
      } satisfies ReviewOutcome
    },
    'Failed to code a bank line',
    { organizationId, transactionId, glAccountCode }
  )
}

// ── Transfer ────────────────────────────────────────────────────────────────

export interface TransferTransactionInput extends ActorParams {
  /** The `bank_account` record the other leg belongs to. */
  counterpartBankAccountId: string
  memo?: string
}

/**
 * Treat a line as one leg of a move between two accounts we own.
 *
 * The detector looks on the counterpart account for a line with the SAME
 * absolute amount, the OPPOSITE sign, within {@link CANDIDATE_DAY_WINDOW} days,
 * that nobody has already coded or matched. When it finds one, both legs are
 * marked `matched` to each other and exactly ONE entry is posted, filed on the
 * outgoing leg.
 *
 * 🛑 **One entry, never two.** Posting from each leg moves cash twice and both
 * entries balance. Filing it on the OUTGOING leg is arbitrary but must be
 * stable, because that is where `undoReview` goes looking for the posting.
 *
 * ⚠️ When no opposite leg is found the transfer still posts - against the
 * counterpart account's own GL code - and the line is stamped `coded` with that
 * code, carrying the counterpart's id in `matchedRecordId` so the leg that
 * arrives later can be recognised. The alternative (refusing until both feeds
 * have caught up) leaves a bookkeeper unable to finish a month because one bank
 * is slower than the other. A warning comes back saying so - and it names
 * Transfer, not Match: `matchTransaction` refuses `bank_transaction` and the
 * router does not accept it.
 *
 * 🛑 **The late leg then takes a LINK-ONLY path and posts nothing.** It is
 * checked for first, before the detector and before any entry is built: the
 * stranded first leg is `coded`, so `pickOppositeLeg` cannot see it, `match`
 * refuses `bank_transaction`, and Transfer is the only treatment the drawer
 * offers - which is how one movement came to post twice. See
 * {@link isLinkableTransferLeg}.
 */
export async function transferTransaction(
  db: Database,
  input: TransferTransactionInput
): Promise<Result<ReviewOutcome, Error>> {
  const { organizationId, actorUserId, transactionId, counterpartBankAccountId, memo } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'transferred')
      assertNotPosted(line)
      const txnDate = requireTxnDate(line)

      if (!line.bankAccountId) {
        throw new UnprocessableEntityError(
          'This bank line is not on an account, so there is nothing to transfer from.'
        )
      }
      if (counterpartBankAccountId === line.bankAccountId) {
        throw new BadRequestError(
          'A transfer moves money between two different accounts. Pick the other one.'
        )
      }

      const counterpart = await getBankAccount(db, {
        organizationId,
        bankAccountId: counterpartBankAccountId,
      })
      if (counterpart.isErr()) throw counterpart.error
      if (!counterpart.value) {
        throw new UnprocessableEntityError('That counterpart bank account does not exist')
      }

      // 🛑 First, and before anything is built: has the OTHER leg already
      // posted this transfer while waiting for this line to arrive? If it has,
      // the movement is in the books once already and the only thing left to do
      // is link the pair. Posting here would be the second cash-to-cash entry
      // for one movement, and it would balance.
      const alreadyPosted = await findPostedCounterpartLeg(db, {
        organizationId,
        line,
        counterpartBankAccountId,
      })
      if (alreadyPosted) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        const linkedAt = new Date().toISOString()
        await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
          bank_transaction_review_status: 'matched',
          bank_transaction_matched_record_id: alreadyPosted.id,
          bank_transaction_matched_record_type: 'bank_transaction',
          bank_transaction_reviewed_at: linkedAt,
          bank_transaction_reviewed_by_user_id: actorUserId,
        })
        // The first leg keeps its posting id - that is where the entry is filed
        // and where `undoReview` goes looking for it - but it stops being a
        // `coded` line pointing at an ACCOUNT and becomes the matched leg of a
        // pair, which is what it would have been had both legs arrived at once.
        await crud.update(toRecordId(ctx.bankTransactionDefId, alreadyPosted.id), {
          bank_transaction_review_status: 'matched',
          bank_transaction_matched_record_id: transactionId,
          bank_transaction_matched_record_type: 'bank_transaction',
          bank_transaction_gl_account: null,
          bank_transaction_reviewed_at: linkedAt,
          bank_transaction_reviewed_by_user_id: actorUserId,
        })
        logger.info('Linked a late transfer leg to the entry the first leg posted', {
          organizationId,
          transactionId,
          filedOnId: alreadyPosted.id,
          glPostingId: alreadyPosted.glPostingId,
        })
        return {
          transaction: await requireBankTransaction(db, organizationId, transactionId),
          // 🛑 Null, and it is the point of this path. The entry already exists.
          post: null,
          warnings: [
            `This is the other half of a transfer that was already posted from bank line ` +
              `${alreadyPosted.id}. The two are now linked and nothing was posted again.`,
          ],
        } satisfies ReviewOutcome
      }

      const opposite = await findOppositeLeg(db, {
        organizationId,
        line,
        counterpartBankAccountId,
      })

      const outgoing = bankLineFlow(line.amountMinor) === 'out'
      const warnings: string[] = []
      if (!opposite) {
        warnings.push(
          `No matching line was found on ${counterpart.value.name ?? 'the counterpart account'} ` +
            `within ${CANDIDATE_DAY_WINDOW} days. The transfer is posted against that account's ` +
            'GL code; when its own line arrives, use Transfer on it too and the two will be ' +
            'linked without posting anything a second time.'
        )
      }

      // 🛑 The entry is filed on the OUTGOING leg whenever we hold it, so that
      // `undoReview` always knows where to look for the posting.
      const filedOn = opposite && !outgoing ? opposite : line
      const other = filedOn === line ? opposite : line
      const fromAccountCode = outgoing
        ? line.bankAccountCode
        : (opposite?.bankAccountCode ?? counterpart.value.glAccountCode)
      const toAccountCode = outgoing
        ? (opposite?.bankAccountCode ?? counterpart.value.glAccountCode)
        : line.bankAccountCode

      const attempt = await countBankTransactionPostings(db, {
        organizationId,
        transactionId: filedOn.id,
      })
      const entry = buildTransferEntry({
        transactionId: filedOn.id,
        periodKey: bankTransactionPeriodKey({
          transactionId: filedOn.id,
          externalId: filedOn.externalId,
          bankAccountId: filedOn.bankAccountId,
          attempt,
        }),
        txnDate: filedOn.postedAt ?? txnDate,
        amountMinor: filedOn.amountMinor,
        fromAccountCode: fromAccountCode ?? '',
        toAccountCode: toAccountCode ?? '',
        memo: memo ?? `Transfer ${line.description ?? ''}`.trim(),
      })

      const lock = await resolvePeriodLock(organizationId)
      const post = await postEntry(db, {
        organizationId,
        entry,
        actorUserId,
        lock,
        memo: memo ?? `Transfer between bank accounts`,
      })

      if (!ACCEPTED_POST_STATUSES.has(post.status)) {
        return {
          transaction: line,
          post: toPostSummary(post),
          warnings,
        } satisfies ReviewOutcome
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const now = new Date().toISOString()
      await crud.update(toRecordId(ctx.bankTransactionDefId, filedOn.id), {
        bank_transaction_review_status: other ? 'matched' : 'coded',
        bank_transaction_matched_record_id: other?.id ?? counterpartBankAccountId,
        bank_transaction_matched_record_type: other ? 'bank_transaction' : 'bank_account',
        bank_transaction_gl_account: other ? undefined : (toAccountCode ?? undefined),
        bank_transaction_gl_posting_id: post.glPostingId ?? undefined,
        bank_transaction_reviewed_at: now,
        bank_transaction_reviewed_by_user_id: actorUserId,
      })
      if (other) {
        // The second leg is `matched` and carries NO posting id: one event, one
        // entry, and the id lives on the leg that filed it.
        await crud.update(toRecordId(ctx.bankTransactionDefId, other.id), {
          bank_transaction_review_status: 'matched',
          bank_transaction_matched_record_id: filedOn.id,
          bank_transaction_matched_record_type: 'bank_transaction',
          bank_transaction_reviewed_at: now,
          bank_transaction_reviewed_by_user_id: actorUserId,
        })
      }

      if (filedOn.bankAccountConnectorId) {
        await pinPostedBankTransaction(db, {
          organizationId,
          bankTransactionId: filedOn.id,
          connectorId: filedOn.bankAccountConnectorId,
        })
      }

      logger.info('Recorded a bank transfer', {
        organizationId,
        transactionId,
        counterpartBankAccountId,
        oppositeLegId: other?.id ?? null,
        docNumber: post.docNumber,
      })
      return {
        transaction: await requireBankTransaction(db, organizationId, transactionId),
        post: toPostSummary(post),
        warnings,
      } satisfies ReviewOutcome
    },
    'Failed to record a bank transfer',
    { organizationId, transactionId, counterpartBankAccountId }
  )
}

/**
 * The other half of a transfer: same absolute amount, opposite sign, on the
 * counterpart account, within the window, and not already dealt with.
 *
 * ⚠️ **Exact on the amount, not within a tolerance.** A transfer between two
 * accounts we own is the same movement seen twice, so the two figures agree to
 * the cent unless a fee was taken - and a fee makes it two events, not one, so
 * the near-miss belongs in front of a person rather than auto-detected.
 *
 * ⚠️ Ties are broken on the closest date, then the smallest id, so the answer
 * is deterministic. Two identical transfers on one day between two accounts
 * would otherwise pair up differently on every call.
 */
async function findOppositeLeg(
  db: Database,
  params: {
    organizationId: string
    line: BankTransactionRow
    counterpartBankAccountId: string
  }
): Promise<BankTransactionRow | null> {
  const { organizationId, line, counterpartBankAccountId } = params
  if (!line.postedAt) return null

  const candidates = await listForReview(db, {
    organizationId,
    bankAccountId: counterpartBankAccountId,
    state: 'all',
    from: shift(line.postedAt, -CANDIDATE_DAY_WINDOW),
    to: shift(line.postedAt, CANDIDATE_DAY_WINDOW),
    limit: 200,
  })
  if (candidates.isErr()) return null

  // The predicate and the tie-break are PURE and live in `client.ts`, so the
  // detection can be tested exhaustively without a database - which matters
  // because a wrong pairing posts a cash-to-cash entry between two accounts
  // that never exchanged money, and it balances.
  return pickOppositeLeg(line, candidates.value)
}

/**
 * The leg that already posted this transfer, or null.
 *
 * Reads the counterpart account's `coded` lines in the window and asks the pure
 * predicate; the predicate is what has to be right, so it lives in `client.ts`
 * where it can be tested exhaustively without a database.
 */
async function findPostedCounterpartLeg(
  db: Database,
  params: {
    organizationId: string
    line: BankTransactionRow
    counterpartBankAccountId: string
  }
): Promise<BankTransactionRow | null> {
  const { organizationId, line, counterpartBankAccountId } = params
  if (!line.postedAt || !line.bankAccountId) return null

  const candidates = await listForReview(db, {
    organizationId,
    bankAccountId: counterpartBankAccountId,
    state: 'coded',
    from: shift(line.postedAt, -CANDIDATE_DAY_WINDOW),
    to: shift(line.postedAt, CANDIDATE_DAY_WINDOW),
    limit: 200,
  })
  if (candidates.isErr()) return null
  return pickLinkableTransferLeg(line, candidates.value)
}

function shift(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

// ── Exclude ─────────────────────────────────────────────────────────────────

export interface ExcludeTransactionInput extends ActorParams {
  reason: string
}

/**
 * Take a line out of the queue without posting or linking anything.
 *
 * 🛑 The reason is REQUIRED. An unexplained exclusion is indistinguishable from
 * an unreviewed one six months later, which is how a 2,390-item backlog is
 * built: every row somebody dismissed without saying why has to be looked at
 * again by the next person.
 *
 * ⚠️ Excluding is a STATUS write, never a delete. The row stays, because it is
 * the evidence that the bank showed something and a person decided it was not
 * ours.
 */
export async function excludeTransaction(
  db: Database,
  input: ExcludeTransactionInput
): Promise<Result<ReviewOutcome, Error>> {
  const { organizationId, actorUserId, transactionId } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotPosted(line)

      const reason = input.reason?.trim()
      if (!reason) {
        throw new BadRequestError(
          'Say why this line is being excluded. An exclusion with no reason reads exactly like ' +
            'an unreviewed line to the next person who opens the queue.'
        )
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
        bank_transaction_review_status: 'excluded',
        bank_transaction_exclude_reason: reason,
        bank_transaction_reviewed_at: new Date().toISOString(),
        bank_transaction_reviewed_by_user_id: actorUserId,
      })

      logger.info('Excluded a bank line', { organizationId, transactionId })
      return {
        transaction: await requireBankTransaction(db, organizationId, transactionId),
        post: null,
        warnings: [],
      } satisfies ReviewOutcome
    },
    'Failed to exclude a bank line',
    { organizationId, transactionId }
  )
}

// ── Undo ────────────────────────────────────────────────────────────────────

export interface UndoReviewInput extends ActorParams {
  memo?: string
}

/**
 * Put a line back in the queue.
 *
 * 🛑 **A coded line REVERSES its posting; it never deletes one.** `GlPostingLine`
 * has no update path and a posted entry is immutable - correct by reversal,
 * never by edit. The reversal is a second `GlPosting` at revision N+1 and both
 * halves stay in the register, which is what a bookkeeper expects to see.
 *
 * A matched line unlinks both sides, including the document's own stamp: a
 * deposit goes back to `pending`, a vendor payment loses its `clearedAt`. A
 * transfer's two legs each unlink from the other, and the posting on the leg
 * that filed it is reversed.
 *
 * ⚠️ **Allowed on a `void` line, deliberately.** The commonest reason to reach
 * for undo is exactly that: a pending charge was coded, the bank voided it, and
 * the posting has to come back out.
 */
export async function undoReview(
  db: Database,
  input: UndoReviewInput
): Promise<Result<ReviewOutcome, Error>> {
  const { organizationId, actorUserId, transactionId, memo } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)

      if (line.reviewStatus === 'for_review') {
        throw new BadRequestError('This bank line is already waiting for review.')
      }

      // 🛑 **The non-filing leg of a transfer refuses undo, and names the one to
      // undo instead.** A transfer posts ONE entry, filed on the other leg;
      // unlinking this one would reset a leg that still carries a live posting
      // to `for_review`, where code and transfer refuse it (it has a posting)
      // and undo refuses it (it is already waiting) - stranded, unreachable by
      // every treatment there is.
      //
      // Refusing is the safer of the two repairs. Reversing the counterpart's
      // posting as a side effect of undoing THIS line can itself be refused (a
      // locked period is the ordinary case at month end), which would leave the
      // pair half unlinked with an entry still standing; and undoing the filing
      // leg already reverses the entry and unlinks BOTH legs, so the path being
      // named is one that exists and does the whole job.
      if (
        !line.glPostingId &&
        line.matchedRecordType === 'bank_transaction' &&
        line.matchedRecordId
      ) {
        const counterpart = await readCounterpartLeg(db, organizationId, line.matchedRecordId)
        if (counterpart?.glPostingId) {
          throw new ConflictError(
            `This transfer's entry is filed on bank line ${counterpart.id}, not on this one. ` +
              'Undo that line instead - it reverses the entry and unlinks both legs.',
            { undoInstead: counterpart.id, glPostingId: counterpart.glPostingId }
          )
        }
      }

      const warnings: string[] = []
      let post: PostResult | null = null
      if (line.glPostingId) {
        // ⚠️ Only a LIVE posting needs reversing. A line can carry the id of an
        // entry that is already `reversed` or `failed` - `already_posted` hands
        // back the existing row, and a failed claim leaves one behind - and
        // reversing that is refused, which would strand the line as `coded`
        // forever with no way back into the queue.
        const [existing] = await db
          .select({ status: schema.GlPosting.status, docNumber: schema.GlPosting.docNumber })
          .from(schema.GlPosting)
          .where(
            and(
              eq(schema.GlPosting.id, line.glPostingId),
              eq(schema.GlPosting.organizationId, organizationId)
            )
          )
          .limit(1)

        if (existing?.status === 'posted') {
          const lock = await resolvePeriodLock(organizationId)
          post = await reverseEntry(db, {
            organizationId,
            glPostingId: line.glPostingId,
            actorUserId,
            lock,
            memo: memo ?? `Undo bank review ${line.externalId ?? transactionId}`,
          })
          if (!ACCEPTED_POST_STATUSES.has(post.status)) {
            // 🛑 Nothing is unlinked when the reversal was refused. A line back
            // in the queue with a live posting behind it would be coded twice.
            return {
              transaction: line,
              post: toPostSummary(post),
              warnings,
            } satisfies ReviewOutcome
          }
        } else {
          warnings.push(
            `Entry ${existing?.docNumber ?? line.glPostingId} is ${existing?.status ?? 'gone'}, ` +
              'not posted, so there was nothing to reverse. The line is back in the queue.'
          )
        }
      }

      // 🛑 The pins come OFF with the reversal. Correcting by reversal has to
      // actually restore the row to what the bank says, or an amended amount
      // stays invisible forever behind a pin nobody remembers setting.
      if (line.bankAccountConnectorId) {
        await unpinPostedBankTransaction(db, {
          organizationId,
          bankTransactionId: transactionId,
          connectorId: line.bankAccountConnectorId,
        })
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)

      if (line.matchedRecordId && line.matchedRecordType) {
        if (line.matchedRecordType === 'bank_transaction') {
          await crud.update(toRecordId(ctx.bankTransactionDefId, line.matchedRecordId), {
            bank_transaction_review_status: 'for_review',
            bank_transaction_matched_record_id: null,
            bank_transaction_matched_record_type: null,
            bank_transaction_reviewed_at: null,
            bank_transaction_reviewed_by_user_id: null,
          })
        } else if (line.matchedRecordType !== 'bank_account') {
          await unstampDocument(db, {
            organizationId,
            actorUserId,
            recordType: line.matchedRecordType,
            recordId: line.matchedRecordId,
          })
        }
      }

      await crud.update(toRecordId(ctx.bankTransactionDefId, transactionId), {
        bank_transaction_review_status: 'for_review',
        bank_transaction_matched_record_id: null,
        bank_transaction_matched_record_type: null,
        bank_transaction_gl_account: null,
        bank_transaction_gl_posting_id: null,
        bank_transaction_exclude_reason: null,
        bank_transaction_reviewed_at: null,
        bank_transaction_reviewed_by_user_id: null,
      })

      logger.info('Undid a bank line review', {
        organizationId,
        transactionId,
        was: line.reviewStatus,
        reversed: post?.status ?? null,
      })
      return {
        transaction: await requireBankTransaction(db, organizationId, transactionId),
        post: post ? toPostSummary(post) : null,
        warnings,
      } satisfies ReviewOutcome
    },
    'Failed to undo a bank line review',
    { organizationId, transactionId }
  )
}

/**
 * The other leg of a transfer, or null when it has been removed.
 *
 * A missing counterpart is not a refusal: the leg this undo is protecting no
 * longer exists, so there is nothing to strand.
 */
async function readCounterpartLeg(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<BankTransactionRow | null> {
  try {
    return await requireBankTransaction(db, organizationId, transactionId)
  } catch {
    return null
  }
}

// ── The document side of a match ────────────────────────────────────────────

/** The bank line a document is already matched to, or null. */
async function readDocumentLink(
  db: Database,
  organizationId: string,
  recordType: MatchRecordType,
  recordId: string
): Promise<string | null> {
  if (recordType === 'payment_transaction') {
    // 🛑 A COLUMN, not `metadata.bankTransactionId` (drizzle 0363). The pointer
    // lived in the JSON blob only because `PaymentTransaction` had no typed home
    // for it, which meant it could not be indexed, could not be constrained, and
    // was invisible to anything that did not already know to open the blob.
    const [row] = await db
      .select({ bankTransactionId: schema.PaymentTransaction.bankTransactionId })
      .from(schema.PaymentTransaction)
      .where(
        and(
          eq(schema.PaymentTransaction.id, recordId),
          eq(schema.PaymentTransaction.organizationId, organizationId)
        )
      )
      .limit(1)
    if (!row) throw new UnprocessableEntityError(`Payment ${recordId} was not found`)
    return row.bankTransactionId ?? null
  }

  const attribute =
    recordType === 'vendor_payment'
      ? 'vendor_payment_bank_transaction_id'
      : recordType === 'bank_deposit'
        ? 'bank_deposit_bank_transaction_id'
        : null
  if (!attribute) {
    // 🛑 `vendor_bill` has no pointer field of its own - `paid_source` records
    // THAT a bank line confirmed it, never WHICH one - so the only record of the
    // link is the bank line's own `matchedRecordId`. Answering null here would
    // make the "already matched to bank line X" refusal unreachable for a bill,
    // and two bank lines could each claim to have paid it.
    return readBankLineClaiming(db, organizationId, recordId)
  }

  const [row] = await db
    .select({ valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, recordId),
        eq(schema.CustomField.systemAttribute, attribute)
      )
    )
    .limit(1)
  return row?.valueText ?? null
}

/**
 * The bank line whose `matchedRecordId` points at this record, or null.
 *
 * The fallback for a document with no pointer field of its own. Archived lines
 * are excluded: a reversed import must not hold a bill hostage.
 */
async function readBankLineClaiming(
  db: Database,
  organizationId: string,
  recordId: string
): Promise<string | null> {
  const [row] = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.valueText, recordId),
        eq(schema.CustomField.systemAttribute, 'bank_transaction_matched_record_id'),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  return row?.entityId ?? null
}

/** Write the document's half of the link. */
async function stampDocument(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    recordType: MatchRecordType
    recordId: string
    transactionId: string
  }
): Promise<void> {
  const { organizationId, actorUserId, recordType, recordId, transactionId } = params
  const now = new Date().toISOString()

  if (recordType === 'bank_deposit') {
    // 🛑 Through the deposit's own writer, never by writing its fields here: it
    // is the writer that also flips the status to `cleared` and freezes the
    // deposit against edits, and a second writer would drift from it.
    const cleared = await clearBankDeposit(db, {
      organizationId,
      actorUserId,
      depositId: recordId,
      bankTransactionId: transactionId,
    })
    if (cleared.isErr()) throw cleared.error
    return
  }

  if (recordType === 'payment_transaction') {
    // 🛑 Two COLUMNS, not three JSON keys (drizzle 0363). The read-modify-write
    // of the whole blob this used to do was also a lost-update waiting to
    // happen: it read `metadata`, spread it, and wrote it back, so anything else
    // writing another key on the same row in between was silently discarded.
    // Setting two columns cannot do that.
    //
    // There is no `confirmationSource` write any more. It carried the
    // `bank_import` vocabulary from `VendorBillPaidSource`, but on this table it
    // said exactly what `bankTransactionId IS NOT NULL` already says, and a
    // second field saying so is a second field that can disagree.
    await db
      .update(schema.PaymentTransaction)
      .set({ bankTransactionId: transactionId, bankClearedAt: new Date(now) })
      .where(
        and(
          eq(schema.PaymentTransaction.id, recordId),
          eq(schema.PaymentTransaction.organizationId, organizationId)
        )
      )
    return
  }

  const defId = await resolveDefIdForRecord(db, organizationId, recordId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  if (recordType === 'vendor_payment') {
    await crud.update(toRecordId(defId, recordId), {
      vendor_payment_bank_transaction_id: transactionId,
      vendor_payment_cleared_at: now,
    })
    return
  }
  if (recordType === 'vendor_bill') {
    await crud.update(toRecordId(defId, recordId), {
      vendor_bill_paid_source: 'bank_import',
    })
  }
}

/** Undo {@link stampDocument}. */
async function unstampDocument(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    recordType: MatchRecordType
    recordId: string
  }
): Promise<void> {
  const { organizationId, actorUserId, recordType, recordId } = params

  if (recordType === 'payment_transaction') {
    // Both columns, together and never one of them (drizzle 0363). A cleared
    // date left standing on a payment with no bank line would read as "this
    // cleared" with nothing able to say against what.
    //
    // ⚠️ The old version wrote `metadata.bankTransactionId = undefined` and
    // saved the object, which is NOT a delete: `JSON.stringify` drops an
    // `undefined` value, so it happened to work, but only because the whole blob
    // was being rewritten. A column set to null is a delete by construction.
    await db
      .update(schema.PaymentTransaction)
      .set({ bankTransactionId: null, bankClearedAt: null })
      .where(
        and(
          eq(schema.PaymentTransaction.id, recordId),
          eq(schema.PaymentTransaction.organizationId, organizationId)
        )
      )
    return
  }

  const defId = await resolveDefIdForRecord(db, organizationId, recordId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  if (recordType === 'vendor_payment') {
    await crud.update(toRecordId(defId, recordId), {
      vendor_payment_bank_transaction_id: null,
      vendor_payment_cleared_at: null,
    })
    return
  }
  if (recordType === 'bank_deposit') {
    // A cleared deposit is frozen against edits by `updateBankDeposit`, so the
    // status and the pointer are cleared directly - this is the one writer that
    // is allowed to un-clear one, and it is only reachable by undoing the match
    // that cleared it.
    await crud.update(toRecordId(defId, recordId), {
      bank_deposit_status: 'pending',
      bank_deposit_bank_transaction_id: null,
      bank_deposit_cleared_at: null,
    })
    return
  }
  if (recordType === 'vendor_bill') {
    await crud.update(toRecordId(defId, recordId), { vendor_bill_paid_source: null })
  }
}

/** The def a record belongs to, so `toRecordId` can be built for it. */
async function resolveDefIdForRecord(
  db: Database,
  organizationId: string,
  recordId: string
): Promise<string> {
  const [row] = await db
    .select({ defId: schema.EntityInstance.entityDefinitionId })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, recordId),
        eq(schema.EntityInstance.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) throw new UnprocessableEntityError(`Record ${recordId} was not found`)
  return row.defId
}

// ── Shared refusals ─────────────────────────────────────────────────────────

/** A `void` line refuses code, match and transfer, by name. */
function assertNotVoid(line: BankTransactionRow, verb: string): void {
  if (line.bankStatus !== 'void') return
  throw new UnprocessableEntityError(
    `This bank line is void - the bank withdrew it, so no money moved. A void line cannot be ` +
      `${verb}. If it already carries a posting, reverse that instead.`,
    { bankStatus: 'void' }
  )
}

/** A line that already produced a posting is corrected by reversal, never re-treated. */
function assertNotPosted(line: BankTransactionRow): void {
  if (!line.glPostingId) return
  throw new ConflictError(
    `This bank line already posted entry ${line.glPostingId}. Undo the review first - a posted ` +
      'entry is corrected by reversing it, never by editing it.',
    { glPostingId: line.glPostingId }
  )
}

/** A line with no bank date cannot be posted: `txnDate` is the period's key. */
function requireTxnDate(line: BankTransactionRow): string {
  if (!line.postedAt) {
    throw new UnprocessableEntityError(
      'This bank line has no date, so there is no period to post it into. Wait for the feed to ' +
        'settle it, or set the date on the record.'
    )
  }
  return line.postedAt
}

/** The half of a `PostResult` the drawer renders. */
function toPostSummary(post: PostResult): ReviewOutcome['post'] {
  return {
    status: post.status,
    error: post.error,
    docNumber: post.docNumber,
    glPostingId: post.glPostingId,
  }
}
