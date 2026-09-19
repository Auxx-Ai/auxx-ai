// packages/lib/src/accounting/banking/review/writes.ts

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
 * The match row is the most important line in this file. The movement's own
 * posting already moves cash for the event the bank line corroborates; a second entry from the feed credits cash TWICE, both entries
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

import { randomUUID } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../../errors'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { toRecordId } from '../../../resources/resource-id'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { listPostingsForSource } from '../../ledger/reads/list-postings'
import type { PostResult } from '../../ledger/types'
import { clearBankDeposit } from '../../money/bank-deposits'
import { acceptVendorPaymentAccounting } from '../../money/vendor-payments/payment-accounting'
import { recordVendorPayment } from '../../money/vendor-payments/record-payment'
import { voidVendorPayment } from '../../money/vendor-payments/void-payment'
import { pinPostedBankTransaction, unpinPostedBankTransaction } from '../feed/pins'
import { requireBankAccountFieldContext, requireReviewFieldContext } from '../fields'
import { guard } from '../guard'
import { getBankAccount } from '../reads'
import { buildCodedBankEntry, buildTransferEntry } from './build-entry'
import {
  BANK_TRANSACTION_SOURCE_TYPE,
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
import { countBankTransactionPostings, listForReview, requireBankTransaction } from './reads'

/**
 * The money-command key prefix a bank match mints its vendor payment under.
 *
 * 🛑 A per-attempt nonce follows it, and it has to: `runMoneyCommand` replays a
 * repeated key, so a stable key would make match → undo → match return the
 * VOIDED movement and record nothing, or throw the retry-key conflict when the
 * second attempt names a different bill. The line's own `reviewStatus` guard is
 * what stops a double match, not the command key. The prefix is what
 * {@link wasRecordedByThisMatch} reads back.
 */
function bankMatchKeyPrefix(transactionId: string): string {
  return `bank-match:${transactionId}:`
}

const logger = createScopedLogger('banking-review')

/** Every treatment carries the same two. */
interface ActorParams {
  organizationId: string
  actorUserId: string
  transactionId: string
}

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
 * - `bank_deposit` - through `clearBankDeposit`, never by writing its fields
 *   here: it is the writer that also flips the deposit to `cleared` and freezes
 *   it against edits, and a second writer would drift from it.
 * - `vendor_bill` - never matched directly: coding an outgoing line to a bill
 *   RECORDS a vendor payment and matches the line to that movement (D9).
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
      const ctx = await requireReviewFieldContext(db, organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'matched')
      // 🛑 A line that already posted may not be re-labelled `matched`. Match
      // posts nothing, so the status would say "this line moved no money of its
      // own" while a live Dr 6100 / Cr 1010 entry stands behind it, and the
      // document it now points at credited the same cash a second time. The
      // remedy is the same one code and transfer name: undo first, which
      // REVERSES the entry, then match.
      await assertNotPosted(db, organizationId, transactionId)

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

      // D9: coding an outgoing line to a bill RECORDS a vendor payment from that
      // bank account, and the line is matched to the movement it is evidence of.
      // The entry is the payment's; the match itself still posts nothing (B5).
      let linkType: MatchRecordType = recordType
      let linkId = recordId
      let recordedPaymentId: string | null = null
      if (recordType === 'vendor_bill') {
        if (line.amountMinor >= 0)
          throw new BadRequestError(
            'Only money leaving the account can pay a vendor bill. This line is a deposit.'
          )
        if (!line.postedAt) throw new BadRequestError('This bank line carries no posted date.')
        const recorded = await recordVendorPayment(db, {
          organizationId,
          userId: actorUserId,
          vendorBillInstanceId: recordId,
          amountMinor: Math.abs(line.amountMinor),
          date: line.postedAt,
          method: 'bank',
          bankAccountInstanceId: line.bankAccountId,
          reference: line.description ?? null,
          commandKey: `${bankMatchKeyPrefix(transactionId)}${randomUUID()}`,
        })
        recordedPaymentId = recorded.moneyTransactionId
        linkType = 'money_transaction'
        linkId = recorded.moneyTransactionId
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.defId, transactionId), {
        bank_transaction_review_status: 'matched',
        bank_transaction_matched_record_id: linkId,
        bank_transaction_matched_record_type: linkType,
        bank_transaction_reviewed_at: new Date().toISOString(),
        bank_transaction_reviewed_by_user_id: actorUserId,
      })

      await stampDocument(db, {
        organizationId,
        actorUserId,
        recordType: linkType,
        recordId: linkId,
        transactionId,
      })

      if (recordedPaymentId)
        await acceptVendorPaymentAccounting(db, {
          organizationId,
          moneyTransactionId: recordedPaymentId,
          actorUserId,
        })

      logger.info('Matched a bank line to a document', {
        organizationId,
        transactionId,
        recordType: linkType,
        recordId: linkId,
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
  /** A `gl_account` id from the org's own chart (task 15 §4). */
  glAccountId: string
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
  const { organizationId, actorUserId, transactionId, glAccountId, memo } = input
  return guard(
    async () => {
      const ctx = await requireReviewFieldContext(db, organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'coded')
      await assertNotPosted(db, organizationId, transactionId)
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
        glAccountId,
        bankAccountGlAccountId: line.bankAccountGlAccountId ?? '',
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
        mode: 'post',
        sources: [
          {
            sourceKind: BANK_TRANSACTION_SOURCE_TYPE,
            sourceId: transactionId,
            linkRole: 'subject',
          },
        ],
      })

      if (!didLedgerAccept(post)) {
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
      await crud.update(toRecordId(ctx.defId, transactionId), {
        bank_transaction_review_status: 'coded',
        bank_transaction_gl_account: glAccountId.trim(),
        bank_transaction_reviewed_at: new Date().toISOString(),
        bank_transaction_reviewed_by_user_id: actorUserId,
      })
      await stampAccountHasPosted(db, { organizationId, actorUserId, line })

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
        glAccountId,
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
    { organizationId, transactionId, glAccountId }
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
      const ctx = await requireReviewFieldContext(db, organizationId)
      const line = await requireBankTransaction(db, organizationId, transactionId)
      assertNotVoid(line, 'transferred')
      await assertNotPosted(db, organizationId, transactionId)
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
        await crud.update(toRecordId(ctx.defId, transactionId), {
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
        await crud.update(toRecordId(ctx.defId, alreadyPosted.id), {
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
      const fromAccountId = outgoing
        ? line.bankAccountGlAccountId
        : (opposite?.bankAccountGlAccountId ?? counterpart.value.glAccountId)
      const toAccountId = outgoing
        ? (opposite?.bankAccountGlAccountId ?? counterpart.value.glAccountId)
        : line.bankAccountGlAccountId

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
        fromAccountId: fromAccountId ?? '',
        toAccountId: toAccountId ?? '',
        memo: memo ?? `Transfer ${line.description ?? ''}`.trim(),
      })

      const lock = await resolvePeriodLock(organizationId)
      const post = await postEntry(db, {
        organizationId,
        entry,
        actorUserId,
        lock,
        memo: memo ?? `Transfer between bank accounts`,
        mode: 'post',
        // Filed on `filedOn`, whichever leg that is - `undoReview` goes looking
        // for the posting there, so the claim has to live there too.
        sources: [
          { sourceKind: BANK_TRANSACTION_SOURCE_TYPE, sourceId: filedOn.id, linkRole: 'subject' },
        ],
      })

      if (!didLedgerAccept(post)) {
        return {
          transaction: line,
          post: toPostSummary(post),
          warnings,
        } satisfies ReviewOutcome
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      const now = new Date().toISOString()
      await crud.update(toRecordId(ctx.defId, filedOn.id), {
        bank_transaction_review_status: other ? 'matched' : 'coded',
        bank_transaction_matched_record_id: other?.id ?? counterpartBankAccountId,
        bank_transaction_matched_record_type: other ? 'bank_transaction' : 'bank_account',
        bank_transaction_gl_account: other ? undefined : (toAccountId ?? undefined),
        bank_transaction_reviewed_at: now,
        bank_transaction_reviewed_by_user_id: actorUserId,
      })
      // 🛑 The FILING leg's account, because that is the one the entry was posted
      // against. The other leg carries no posting id and its account is stamped
      // by its own treatment if and when one posts from it.
      await stampAccountHasPosted(db, { organizationId, actorUserId, line: filedOn })
      if (other) {
        // The second leg is `matched` and carries NO posting id: one event, one
        // entry, and the id lives on the leg that filed it.
        await crud.update(toRecordId(ctx.defId, other.id), {
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
      const ctx = await requireReviewFieldContext(db, organizationId)
      // Existence check only - excluding needs nothing else off the row.
      await requireBankTransaction(db, organizationId, transactionId)
      await assertNotPosted(db, organizationId, transactionId)

      const reason = input.reason?.trim()
      if (!reason) {
        throw new BadRequestError(
          'Say why this line is being excluded. An exclusion with no reason reads exactly like ' +
            'an unreviewed line to the next person who opens the queue.'
        )
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(toRecordId(ctx.defId, transactionId), {
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
      const ctx = await requireReviewFieldContext(db, organizationId)
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
      const ownPosting = await findLiveBankTransactionPosting(db, organizationId, transactionId)
      if (!ownPosting && line.matchedRecordType === 'bank_transaction' && line.matchedRecordId) {
        const counterpartPosting = await findLiveBankTransactionPosting(
          db,
          organizationId,
          line.matchedRecordId
        )
        if (counterpartPosting) {
          throw new ConflictError(
            `This transfer's entry is filed on bank line ${line.matchedRecordId}, not on this one. ` +
              'Undo that line instead - it reverses the entry and unlinks both legs.',
            { undoInstead: line.matchedRecordId, glPostingId: counterpartPosting.id }
          )
        }
      }

      const warnings: string[] = []
      let post: PostResult | null = null
      // ⚠️ The MOST RECENT posting, not `ownPosting` above - that one already
      // excludes `reversed`, and this decision needs to tell "nothing was ever
      // posted" (silent) apart from "posted, and already reversed by something
      // else" (a warning).
      const latest = await findMostRecentBankTransactionPosting(db, organizationId, transactionId)
      if (latest) {
        if (latest.status === 'posted') {
          const lock = await resolvePeriodLock(organizationId)
          post = await reverseEntry(db, {
            organizationId,
            glPostingId: latest.id,
            actorUserId,
            lock,
            memo: memo ?? `Undo bank review ${line.externalId ?? transactionId}`,
          })
          if (!didLedgerAccept(post)) {
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
            `Entry ${latest.docNumber ?? latest.id} is ${latest.status}, ` +
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
          await crud.update(toRecordId(ctx.defId, line.matchedRecordId), {
            bank_transaction_review_status: 'for_review',
            bank_transaction_matched_record_id: null,
            bank_transaction_matched_record_type: null,
            bank_transaction_reviewed_at: null,
            bank_transaction_reviewed_by_user_id: null,
          })
        } else if (line.matchedRecordType !== 'bank_account') {
          // A vendor payment THIS match recorded (D9) is VOIDED, never deleted:
          // its posting is reversed and its applications taken back, so the bill
          // owes what it owed. A payment recorded by hand is only unlinked.
          const minedHere = await wasRecordedByThisMatch(
            db,
            organizationId,
            transactionId,
            line.matchedRecordType,
            line.matchedRecordId
          )
          if (minedHere)
            await voidVendorPayment(db, {
              organizationId,
              userId: actorUserId,
              moneyTransactionId: line.matchedRecordId,
              reason: memo ?? `Undo bank review ${line.externalId ?? transactionId}`,
              commandKey: `bank-match-undo:${transactionId}:${randomUUID()}`,
            })
          await unstampDocument(db, {
            organizationId,
            actorUserId,
            recordType: line.matchedRecordType,
            recordId: line.matchedRecordId,
          })
        }
      }

      await crud.update(toRecordId(ctx.defId, transactionId), {
        bank_transaction_review_status: 'for_review',
        bank_transaction_matched_record_id: null,
        bank_transaction_matched_record_type: null,
        bank_transaction_gl_account: null,
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
 * Record, on the BANK ACCOUNT, that a line on it has produced a journal entry.
 *
 * 🛑 **Write-once, and nothing ever clears it.** Not `undoReview`, not a
 * reversal, not `reverseImport`: the `GlPosting` and its reversal both stay in
 * the books forever with a row on this account as their source document, so an
 * account that permanently changed the ledger must never become deletable again.
 * It is a high-water mark, not a current state, and the one-way-ness IS the
 * feature (plans/bank-connection/08-removing-a-bank-account.md §5.1).
 *
 * 🛑 Called at BOTH sites where a bank line first produces an entry - the code
 * treatment and the transfer treatment. Missing either one puts a hole in the
 * removal gate, and the hole is a hard delete of an account whose rows are a
 * posting's source documents.
 *
 * ⚠️ Errors propagate rather than being swallowed. A stamp that failed silently
 * is exactly the hole above; a failed treatment is visible and retryable.
 */
async function stampAccountHasPosted(
  db: Database,
  params: { organizationId: string; actorUserId: string; line: BankTransactionRow }
): Promise<void> {
  const { organizationId, actorUserId, line } = params
  // A line with no account cannot post - `buildCodedBankEntry` needs the bank
  // account's GL code - so this is defensive rather than a real branch.
  if (!line.bankAccountId) return
  const ctx = await requireBankAccountFieldContext(db, organizationId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  await crud.update(toRecordId(ctx.defId, line.bankAccountId), {
    bank_account_has_posted: true,
  })
}

// ── The document side of a match ────────────────────────────────────────────

/** The bank line a document is already matched to, or null. */
async function readDocumentLink(
  db: Database,
  organizationId: string,
  recordType: MatchRecordType,
  recordId: string
): Promise<string | null> {
  const attribute =
    recordType === 'bank_deposit'
      ? 'bank_deposit_bank_transaction_id'
      : recordType === 'payout'
        ? 'payout_bank_transaction_id'
        : null
  if (!attribute) {
    // 🛑 `vendor_bill` and `money_transaction` have no pointer field of their
    // own, so the only record of the link is the bank line's own
    // `matchedRecordId`. Answering null here would make the "already matched to
    // bank line X" refusal unreachable, and two lines could each claim it.
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

  // 🛑 Nothing to stamp on a movement: `MoneyTransaction` has no bank-line
  // column, so the bank line's own `matchedRecordId` is the whole link - which
  // is what `readDocumentLink` reads back for it.
  if (recordType === 'money_transaction') return
  const defId = await resolveDefIdForRecord(db, organizationId, recordId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
  if (recordType === 'payout') {
    // 🛑 Prevention half of the duplicate detector (brief 18 §1). A matched
    // payout posts nothing of its own - the payout's own sync already posted
    // `Dr bank / Cr clearing`, and this bank line is confirmation, not a second
    // event.
    await crud.update(toRecordId(defId, recordId), {
      payout_bank_transaction_id: transactionId,
    })
  }
}

/**
 * Whether this match is the thing that RECORDED the vendor payment behind it.
 *
 * 🛑 The two halves of D9 undo differently. A line coded to a BILL mints a
 * payment, so undoing it has to take that payment back. A line MATCHED to a
 * payment somebody recorded by hand is evidence of money that moved without the
 * feed's help, and undoing the match must only unlink — voiding it would reverse
 * a posting and reopen a bill nobody asked to touch.
 *
 * The provenance is the movement's own command: `record_vendor_payment` keyed
 * under this line's match prefix. A hand-recorded payment carries the dialog's
 * key instead, and a payment minted by a DIFFERENT line carries that line's.
 */
async function wasRecordedByThisMatch(
  db: Database,
  organizationId: string,
  transactionId: string,
  recordType: MatchRecordType,
  recordId: string
): Promise<boolean> {
  if (recordType !== 'money_transaction') return false
  const movement = await db.query.MoneyTransaction.findFirst({
    where: and(
      eq(schema.MoneyTransaction.organizationId, organizationId),
      eq(schema.MoneyTransaction.id, recordId),
      eq(schema.MoneyTransaction.purpose, 'vendor_payment')
    ),
  })
  if (!movement) return false
  const command = await db.query.MoneyCommand.findFirst({
    where: and(
      eq(schema.MoneyCommand.organizationId, organizationId),
      eq(schema.MoneyCommand.id, movement.recordedByCommandId)
    ),
  })
  return (
    command?.kind === 'record_vendor_payment' &&
    command.commandKey.startsWith(bankMatchKeyPrefix(transactionId))
  )
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

  // 🛑 Nothing to stamp on a movement: `MoneyTransaction` has no bank-line
  // column, so the bank line's own `matchedRecordId` is the whole link - which
  // is what `readDocumentLink` reads back for it.
  if (recordType === 'money_transaction') return
  const defId = await resolveDefIdForRecord(db, organizationId, recordId)
  const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
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
  if (recordType === 'payout') {
    await crud.update(toRecordId(defId, recordId), { payout_bank_transaction_id: null })
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

/**
 * The bank line's current LIVE posting - `posted`, never `reversed` - or
 * `null`. Read through `listPostingsForSource` (TARGET §1), never the
 * `bank_transaction_gl_posting_id` stamp: the stamp holds only the latest
 * write and a reversal does not clear it here the way `undoReview` used to.
 */
async function findLiveBankTransactionPosting(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<{ id: string; docNumber: string | null; status: string } | null> {
  const postings = await listPostingsForSource(db, {
    organizationId,
    sourceKind: BANK_TRANSACTION_SOURCE_TYPE,
    sourceId: transactionId,
  })
  if (postings.isErr()) return null
  const live = postings.value.find((posting) => posting.status !== 'reversed')
  return live ? { id: live.id, docNumber: live.docNumber, status: live.status } : null
}

/**
 * The bank line's most recent posting, whatever its status - `undoReview`
 * needs to tell "nothing was ever posted" (silent) apart from "something was
 * posted and it is already reversed" (a warning), which
 * {@link findLiveBankTransactionPosting} cannot answer since it excludes
 * `reversed` by design.
 */
async function findMostRecentBankTransactionPosting(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<{ id: string; docNumber: string | null; status: string } | null> {
  const postings = await listPostingsForSource(db, {
    organizationId,
    sourceKind: BANK_TRANSACTION_SOURCE_TYPE,
    sourceId: transactionId,
  })
  if (postings.isErr()) return null
  const [latest] = postings.value
  return latest ? { id: latest.id, docNumber: latest.docNumber, status: latest.status } : null
}

/** A line that already produced a posting is corrected by reversal, never re-treated. */
async function assertNotPosted(
  db: Database,
  organizationId: string,
  transactionId: string
): Promise<void> {
  const live = await findLiveBankTransactionPosting(db, organizationId, transactionId)
  if (!live) return
  throw new ConflictError(
    `This bank line already posted entry ${live.id}. Undo the review first - a posted ` +
      'entry is corrected by reversing it, never by editing it.',
    { glPostingId: live.id }
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
