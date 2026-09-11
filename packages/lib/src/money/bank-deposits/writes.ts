// packages/lib/src/money/bank-deposits/writes.ts

/**
 * Grouping received payments into a bank deposit, posting the one cash line it
 * produces, clearing it against a bank statement line, and correcting it while
 * that is still allowed (plans/accounting/tasks/06-deposit-grouping.md).
 *
 * Writes only; the reads live in `reads.ts`. No permission checks - the router
 * asserts `ledgerPost` (`docs/lib-module-guide.md` §6).
 *
 * ## The model, in four lines
 *
 * ```
 *   payment received                 ->  Dr undeposited_funds  Cr accounts_receivable
 *   payments grouped into a deposit  ->  (no posting - grouping only)
 *   deposit hits the bank            ->  Dr <the chosen bank account, by gl_account ID>
 *                                             Cr undeposited_funds
 *                                             ^ ONE line, matches ONE bank line
 * ```
 *
 * 🛑 **The debit is the bank account the operator picked, by `gl_account` id
 * (task 15 §4), not the `cash` role.** An org with two bank accounts (`1000
 * Checking`, `1020 Savings`)
 * banks into whichever one it names on the slip, and the role resolves to
 * exactly one of them; posting the role would put every deposit into `1000` and
 * `1020` would never move, while the entry balanced and the field the operator
 * filled in survived only in the memo.
 *
 * ⚠️ **That takes the entry out of `findWriterConflicts`' sight**, because that
 * guard only sees ROLE lines and `bank_deposit` is declared there as the single
 * `cash` writer (`postings/regime.ts`). The declaration is now vacuous for this
 * type. It is still the only door that writes a bank account for a deposit, and
 * a matched bank-feed line posts nothing (bank plan B5), so there is still one
 * writer - it is simply no longer mechanically asserted. The guard would have to
 * become code-aware, or `bank_deposit` be redeclared as driving no role, for it
 * to say something true again; `regime.ts` is coordinator-held.
 *
 * ⚠️ A BANK deposit. `money/payments/deposit.ts` is a customer prepayment - a
 * liability - and they share nothing but the word.
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { BadRequestError, ConflictError, UnprocessableEntityError } from '../../errors'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { ACCOUNT_ROLES, buildEntry } from '../../postings/build-entry'
import { loadChartAccountsById } from '../../postings/chart-accounts'
import { isExpectedPostOutcome } from '../../postings/ledger-accepted'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY, postEntry } from '../../postings/post-entry'
import type { PostResult } from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { toRecordId } from '../../resources/resource-id'
import { BANK_DEPOSIT_SOURCE_TYPE, isBankDepositFrozen, resolvePaymentRoute } from './client'
import { guard } from './guard'
import {
  type DepositBankAccount,
  loadBankDepositFieldContext,
  readBankDepositDetail,
  readDepositBankAccount,
  readPaymentsByIds,
  requireBankDepositFieldContext,
  requireBankDepositWriteContext,
  requireDepositBankAccountContext,
  requirePaymentFieldContext,
} from './reads'
import type {
  BankDepositDetail,
  ClearBankDepositInput,
  CreateBankDepositInput,
  CreateBankDepositResult,
  UpdateBankDepositInput,
} from './types'

const logger = createScopedLogger('bank-deposits')

/** `YYYY-MM-DD`, and nothing else. A posting's date is a contract, not a hint. */
function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestError(`${label} must be a YYYY-MM-DD date, got "${value}"`)
  }
}

/**
 * Take `SELECT ... FOR UPDATE` over the payment instances a deposit is about to
 * claim, inside the caller's transaction.
 *
 * 🛑 The lock is on `EntityInstance`, not on the `payment_bank_deposit`
 * `FieldValue` row, and that is the point: the row a racing writer has not
 * created yet cannot be locked, so locking the payment itself is the only thing
 * both transactions are guaranteed to contend on. Ordering by id keeps two
 * overlapping selections from deadlocking against each other.
 *
 * Returns nothing. The caller re-reads the link under the lock and refuses on
 * what it finds there; this only makes that read trustworthy.
 */
async function lockPayments(
  db: Database,
  organizationId: string,
  paymentDefId: string,
  paymentIds: string[]
): Promise<void> {
  if (paymentIds.length === 0) return
  await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, paymentDefId),
        inArray(schema.EntityInstance.id, paymentIds)
      )
    )
    .orderBy(asc(schema.EntityInstance.id))
    .for('update')
}

/**
 * Group N received payments into one bank deposit and post
 * `Dr <bank account's gl_account id> Cr undeposited_funds`.
 *
 * ## What it refuses, and why each refusal exists
 *
 * - **A payment that is already in a deposit.** "Which deposit was this cheque
 *   in" must have exactly one answer. `FieldValue` cannot express the
 *   constraint, so it is read and refused here, naming the deposit.
 * - **A payment whose route is not `undeposited_funds`.** An ACH arrives as its
 *   own bank line and a card settles as a net payout; banking either would
 *   assert a bank line that does not exist. The route table
 *   (`accounting.paymentRoute.*`) is the authority, never the caller.
 * - **Mixed currencies**, explicitly, rather than posting the sum at an implied
 *   1.0 rate. Same for a single currency that is not the ledger's: the ledger
 *   is pinned to {@link LEDGER_CURRENCY} and converting is out of scope.
 * - **A zero or negative total**, which is a deposit that moves nothing.
 *
 * ## Order of operations
 *
 * The payments are READ, checked and linked in ONE transaction, then the entry
 * is posted AFTER it commits - a provider call inside an open transaction holds
 * the claim's index tuple for an HTTP round trip. The posting keys its document
 * number on the deposit's own `number` (`DEP-0001`), which the create hook
 * issues, so the record has to exist first.
 *
 * 🛑 **The read is inside the transaction, under a row lock, and that is not
 * tidiness.** `payment_bank_deposit` is a `FieldValue` row and no unique index
 * can express "at most one deposit per payment" over it. Reading the link
 * outside the transaction leaves the whole check-then-write a read-modify-write
 * race: two operators banking overlapping selections at the same moment both see
 * `bankDepositId: null`, both pass the refusal, and both post a cash line for the
 * same cheque. Cash is then overstated by that cheque and both entries balance.
 * {@link lockPayments} takes `SELECT ... FOR UPDATE` over the payment instances
 * first, so the second transaction blocks until the first commits and then reads
 * the link the first one wrote.
 *
 * 🛑 **A refused post is rolled back.** If the ledger will not take the entry -
 * a locked period, a bank account mapped to an id that is not in this chart -
 * the deposit is archived and the payments are unlinked, so the refusal leaves
 * no half-state and the same cheques can be grouped again once the operator
 * has fixed what the message names. That is NOT a correct-by-editing
 * exception: nothing was posted, so there is nothing to reverse.
 */
export async function createBankDeposit(
  db: Database,
  params: { organizationId: string; actorUserId: string } & CreateBankDepositInput
): Promise<Result<CreateBankDepositResult, Error>> {
  const { organizationId, actorUserId, paymentIds, depositDate, bankAccountId, reference } = params

  return guard(
    async () => {
      assertIsoDate(depositDate, 'Deposit date')
      if (!bankAccountId.trim()) {
        throw new BadRequestError('A deposit must name the bank account the money lands in')
      }
      const bankAccount = await requireDepositTarget(db, organizationId, bankAccountId.trim())
      const bankAccountGlAccountId = bankAccount.glAccountId
      const uniqueIds = [...new Set(paymentIds)]
      if (uniqueIds.length === 0) {
        throw new BadRequestError('Select at least one payment to bank')
      }

      const depositCtx = await requireBankDepositWriteContext(organizationId)
      const paymentCtx = await requirePaymentFieldContext(organizationId)
      const settings = await getOrgCache().get(organizationId, 'orgSettings')

      // ── The read, the checks and the writes, in ONE locked transaction ──
      const { depositId, totalMinor, paymentCount } = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database

        // Serialises overlapping selections. Everything below re-reads the
        // link under this lock, so the loser sees the winner's deposit.
        await lockPayments(txDb, organizationId, paymentCtx.paymentDefId, uniqueIds)

        const payments = await readPaymentsByIds(txDb, organizationId, paymentCtx, uniqueIds)
        const found = new Set(payments.map((payment) => payment.paymentId))
        const missing = uniqueIds.filter((id) => !found.has(id))
        if (missing.length > 0) {
          throw new UnprocessableEntityError(
            `${missing.length} of the selected payments no longer exist in this organization`,
            { missing: missing.join(', ') }
          )
        }

        const alreadyBanked = payments.filter((payment) => payment.bankDepositId != null)
        if (alreadyBanked.length > 0) {
          throw new ConflictError(
            `${alreadyBanked.length} of the selected payments are already in a bank deposit. ` +
              'A payment can be in exactly one deposit - remove it from that deposit first.',
            { paymentIds: alreadyBanked.map((payment) => payment.paymentId).join(', ') }
          )
        }

        const misrouted = payments.filter(
          (payment) => resolvePaymentRoute(payment.method, settings) !== 'undeposited_funds'
        )
        if (misrouted.length > 0) {
          const methods = [...new Set(misrouted.map((payment) => payment.method ?? 'unknown'))]
          throw new UnprocessableEntityError(
            `These payments do not route through undeposited funds (${methods.join(', ')}), so ` +
              'they arrive at the bank on their own line and must not be grouped. Change the ' +
              'route under Accounting settings if that is wrong.',
            { methods: methods.join(', ') }
          )
        }

        const currencies = [
          ...new Set(payments.map((payment) => payment.currency).filter((c): c is string => !!c)),
        ]
        if (currencies.length > 1) {
          throw new UnprocessableEntityError(
            `A deposit cannot mix currencies (${currencies.join(', ')}). Bank each currency ` +
              'separately - grouping them would post the sum at an implied 1.0 rate.',
            { currencies: currencies.join(', ') }
          )
        }
        if (currencies.length === 1 && currencies[0] !== LEDGER_CURRENCY) {
          throw new UnprocessableEntityError(
            `These payments are in ${currencies[0]} and the ledger is kept in ${LEDGER_CURRENCY}. ` +
              'Posting them would use an implied 1.0 rate, so the deposit is refused rather ' +
              'than mis-stated.',
            { currency: currencies[0]! }
          )
        }

        const total = payments.reduce((sum, payment) => sum + payment.amountMinor, 0)
        if (!Number.isInteger(total) || total <= 0) {
          throw new UnprocessableEntityError(
            `A deposit total must be a positive whole number of minor units, got ${total}`,
            { totalMinor: String(total) }
          )
        }

        const crud = new UnifiedCrudHandler(organizationId, actorUserId, txDb)
        const created = await crud.create(depositCtx.depositDefId, {
          bank_deposit_date: depositDate,
          bank_deposit_bank_account: bankAccountGlAccountId,
          bank_deposit_bank_account_record: bankAccount.recordId,
          bank_deposit_reference: reference?.trim() || undefined,
          bank_deposit_status: 'pending',
          bank_deposit_total: total,
        })
        const depositRecordId = toRecordId(depositCtx.depositDefId, created.instance.id)
        for (const payment of payments) {
          await crud.update(payment.recordId, { payment_bank_deposit: depositRecordId })
        }
        return {
          depositId: created.instance.id,
          totalMinor: total,
          paymentCount: payments.length,
        }
      })

      const deposit = await readBankDepositDetail(db, organizationId, depositId)
      if (!deposit) {
        throw new UnprocessableEntityError('The bank deposit could not be read back after writing')
      }

      // 🛑 The org's own accounting-off case is checked FIRST, before the build
      // and the post below that exist only to reach the ledger (task 17 §3):
      // grouping payments into a deposit and banking them is real whether or
      // not the org has ever turned accounting on.
      let post: PostResult
      if (!(await isAccountingEnabled(db, organizationId))) {
        post = { status: 'not_enabled' }
      } else {
        // Resolved once, for the memo only - never posted as a label. A miss
        // (the account was deleted between the read above and here) falls back
        // to the id rather than blocking the entry; `resolveAccountLines`
        // still validates the id itself before anything is claimed.
        const debitLabel = await describeDebitAccount(db, organizationId, bankAccountGlAccountId)

        // ── The posting, after the commit ────────────────────────────────
        //
        // `periodKey` is the deposit's own NUMBER, not a date: two deposits can
        // be banked on one day, and a date key would collide them into one
        // entry whose total ties to neither bank line (`postings/doc-number.ts`).
        const entry = buildEntry({
          postingType: 'bank_deposit',
          periodKey: deposit.number ?? depositId,
          txnDate: depositDate,
          lines: [
            {
              // 🛑 The account the operator NAMED, by id, not the `cash` role.
              // An org with `1000 Checking` and `1020 Savings` maps the role to
              // one of them; the role would send every deposit there and leave
              // the other account dead, with the entry balancing either way.
              // `resolveAccountLines` validates the id against this org's own
              // chart and refuses by name when it is missing, inactive or
              // archived, so a bad id is a rolled-back refusal, not a bad post.
              glAccountId: bankAccountGlAccountId,
              direction: 'debit',
              amount: totalMinor,
              memo: `Bank deposit ${deposit.number ?? ''} to ${debitLabel}`.trim(),
              sourceType: BANK_DEPOSIT_SOURCE_TYPE,
              sourceId: depositId,
              sortOrder: 0,
            },
            {
              accountRole: ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
              direction: 'credit',
              amount: totalMinor,
              memo: `${paymentCount} payment${paymentCount === 1 ? '' : 's'} banked`,
              sourceType: BANK_DEPOSIT_SOURCE_TYPE,
              sourceId: depositId,
              sortOrder: 1,
            },
          ],
        })

        const lock = await resolvePeriodLock(organizationId)
        post = await postEntry(db, {
          organizationId,
          entry,
          actorUserId,
          lock,
          memo: reference ? `Deposit slip ${reference}` : undefined,
        })
      }

      if (!isExpectedPostOutcome(post)) {
        await rollbackDeposit(db, organizationId, actorUserId, deposit)
        logger.warn('Bank deposit rolled back - the LEDGER refused the entry', {
          organizationId,
          depositId,
          status: post.status,
          error: post.error,
        })
        return { deposit: { ...deposit, payments: [] }, post }
      }

      if (post.glPostingId) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(deposit.recordId, { bank_deposit_gl_posting_id: post.glPostingId })
      }

      // 🛑 Only when the entry actually posted. `not_enabled`/`not_connected`
      // leave nothing on the ledger for this account, so stamping the
      // write-once high-water mark for either would make an account with
      // nothing on it permanently un-deletable.
      if (post.glPostingId) {
        await stampBankAccountHasPosted(db, organizationId, actorUserId, bankAccount)
      }

      logger.info('Recorded bank deposit', {
        organizationId,
        depositId,
        number: deposit.number,
        totalMinor,
        payments: paymentCount,
        status: post.status,
      })

      const settled = await readBankDepositDetail(db, organizationId, depositId)
      return { deposit: settled ?? deposit, post }
    },
    'Failed to create bank deposit',
    { organizationId, paymentIds: paymentIds.length }
  )
}

/**
 * The account this deposit is banked into, refused by name when it cannot take one.
 *
 * 🛑 **An ACCOUNT is named and the `gl_account` id is read off it, never the
 * other way round.** The bank feed posts every line on an account against that
 * account's `glAccountId`, so an id chosen freely from the chart puts the
 * deposit and the statement line it exists to match into two different
 * accounts. Nothing downstream catches it - match candidates are found by
 * amount and date, not by account. The deposit picker has always worked this
 * way; taking the id here is what stops any other caller working differently.
 *
 * ⚠️ Both refusals are `UnprocessableEntityError` and both name the account,
 * because both are fixed somewhere else in the product rather than by retrying.
 */
async function requireDepositTarget(
  db: Database,
  organizationId: string,
  bankAccountId: string
): Promise<DepositBankAccount & { glAccountId: string }> {
  const ctx = await requireDepositBankAccountContext(organizationId)
  const account = await readDepositBankAccount(db, organizationId, ctx, bankAccountId)
  if (!account) {
    throw new UnprocessableEntityError('That bank account does not exist in this organization')
  }
  if (account.archivedAt) {
    throw new UnprocessableEntityError(
      `${account.name ?? 'That bank account'} is archived, so nothing can be banked into it. ` +
        'Restore it, or pick another account.'
    )
  }
  if (!account.glAccountId) {
    throw new UnprocessableEntityError(
      `${account.name ?? 'That bank account'} is not mapped to an account in the chart of ` +
        'accounts, so there is no account to debit. Map it under Banking first.'
    )
  }
  return { ...account, glAccountId: account.glAccountId }
}

/**
 * `code name` for one `gl_account` id, for a memo or a refusal sentence.
 *
 * One id, never a list - this runs once per deposit write, not per row of a
 * list. Falls back to the raw id rather than throwing: the id itself is what
 * `resolveAccountLines` validates before anything is claimed, so a display
 * miss here must never block the write.
 */
async function describeDebitAccount(
  db: Database,
  organizationId: string,
  glAccountId: string
): Promise<string> {
  try {
    const { accounts } = await loadChartAccountsById(
      db,
      organizationId,
      [glAccountId],
      'This organization has no chart of accounts provisioned'
    )
    const account = accounts.get(glAccountId)
    return account ? `${account.code} ${account.name}`.trim() : glAccountId
  } catch {
    return glAccountId
  }
}

/**
 * Record on the BANK ACCOUNT that something on it has reached the books.
 *
 * 🛑 The same write-once high-water mark `banking/review/writes.ts` stamps when a
 * bank LINE posts, and for the same reason: a posted deposit debits this
 * account's chart mapping and names this account as where the money went, so the
 * account has permanently changed the ledger and must never become hard-deletable
 * again. Feeding the EXISTING term is deliberate -
 * `plans/bank-connection/08-removing-a-bank-account.md` §5.1 says one term
 * decides delete versus archive, and a second blocker beside it would be a
 * second answer to the same question.
 *
 * ⚠️ Called only after the ledger ACCEPTED the entry. A refused post rolls the
 * deposit back, and stamping a high-water mark for an entry that does not exist
 * would make an account with nothing on it permanently un-deletable.
 *
 * ⚠️ Failures are logged, not thrown. The deposit and its entry are already
 * written, and turning an accepted post into an error would report work that
 * actually happened as a failure. The cost of a miss is one account that stays
 * deletable when it should not be, which the operator sees named in the confirm
 * dialog before anything goes.
 */
async function stampBankAccountHasPosted(
  db: Database,
  organizationId: string,
  actorUserId: string,
  account: DepositBankAccount
): Promise<void> {
  try {
    const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
    await crud.update(account.recordId, { bank_account_has_posted: true })
  } catch (error) {
    logger.error('Failed to stamp bank_account_has_posted after a bank deposit', {
      organizationId,
      bankAccountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Undo a deposit whose posting was refused: unlink the payments, archive the row.
 *
 * A compensating write rather than one transaction with the post, because
 * `postEntry` opens its own transaction and makes a network call. Failures here
 * are logged and swallowed: the caller is already carrying a refusal, and
 * replacing it with a rollback error would hide the thing that actually went
 * wrong.
 */
/**
 * Undo a deposit whose entry the LEDGER refused.
 *
 * 🛑 Only a pre-claim refusal reaches here - a closed period, an unbalanced
 * entry, an unassigned role, an inventory code. Those write no `GlPosting` row,
 * so there is nothing on the ledger side to undo and releasing the payments is
 * the whole job.
 *
 * A refused EXPORT must never reach here. The entry is posted, the deposit is
 * real, and the copy is retried by `retryExport`.
 */
async function rollbackDeposit(
  db: Database,
  organizationId: string,
  actorUserId: string,
  deposit: BankDepositDetail
): Promise<void> {
  try {
    const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
    for (const payment of deposit.payments) {
      await crud.update(payment.recordId, { payment_bank_deposit: null })
    }
    await crud.archive(deposit.recordId)
  } catch (error) {
    logger.error('Failed to roll back a refused bank deposit', {
      organizationId,
      depositId: deposit.depositId,
      error,
    })
  }
}

/**
 * Match a deposit to the bank statement line that shows it: `cleared`,
 * `clearedAt`, `bankTransactionId`.
 *
 * 🛑 This is the write that FREEZES the row. After it,
 * {@link updateBankDeposit} refuses, because a reconciled month must not change
 * silently underneath the person who signed it off. Correct by reversing the
 * posting and regrouping, never by editing.
 *
 * `bankTransactionId` is bare TEXT and carries the same name and meaning as
 * the vendor payment's own bank-transaction column, so the matcher has one
 * shape to look for rather than two.
 */
export async function clearBankDeposit(
  db: Database,
  params: { organizationId: string; actorUserId: string } & ClearBankDepositInput
): Promise<Result<BankDepositDetail, Error>> {
  const { organizationId, actorUserId, depositId, bankTransactionId, clearedAt } = params

  return guard(
    async () => {
      await requireBankDepositFieldContext(organizationId)
      const deposit = await readBankDepositDetail(db, organizationId, depositId)
      if (!deposit) throw new UnprocessableEntityError('That bank deposit does not exist')

      if (!bankTransactionId.trim()) {
        throw new BadRequestError('Clearing a deposit must name the bank line it matched')
      }
      if (deposit.status === 'cleared') {
        throw new ConflictError(
          `Deposit ${deposit.number ?? depositId} is already cleared against bank line ` +
            `${deposit.bankTransactionId ?? 'unknown'}.`
        )
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      await crud.update(deposit.recordId, {
        bank_deposit_status: 'cleared',
        bank_deposit_cleared_at: (clearedAt ?? new Date()).toISOString(),
        bank_deposit_bank_transaction_id: bankTransactionId.trim(),
      })

      logger.info('Cleared bank deposit', { organizationId, depositId, bankTransactionId })
      const settled = await readBankDepositDetail(db, organizationId, depositId)
      return settled ?? deposit
    },
    'Failed to clear bank deposit',
    { organizationId, depositId }
  )
}

/**
 * Correct a deposit's slip details while that is still allowed.
 *
 * 🛑 Refuses once the deposit is `cleared` or carries a `bankTransactionId`,
 * with a `ConflictError` that NAMES the bank line - the whole point of the
 * message is that the reader can go and look at it. Same rule as the movement
 * ledger: correct by reversing, never by editing.
 *
 * 🛑 `depositDate` AND the bank account are additionally frozen once the entry
 * has posted, even while the deposit is still pending. They are the posting's
 * `txnDate` and its debit account, and a posted entry is immutable, so editing
 * either here would leave the record claiming one thing and the ledger holding
 * another - a disagreement no reader could detect. The account is the one that
 * matters more: after a code line landed on `1000`, an edit to `1020` would make
 * the slip say the money is in savings while the balance sheet keeps it in
 * checking, and the bank reconciliation of BOTH accounts would then be wrong.
 * Reverse the posting and regroup.
 */
export async function updateBankDeposit(
  db: Database,
  params: { organizationId: string; actorUserId: string } & UpdateBankDepositInput
): Promise<Result<BankDepositDetail, Error>> {
  const { organizationId, actorUserId, depositId, depositDate, bankAccountId, reference } = params

  return guard(
    async () => {
      await requireBankDepositFieldContext(organizationId)
      const deposit = await readBankDepositDetail(db, organizationId, depositId)
      if (!deposit) throw new UnprocessableEntityError('That bank deposit does not exist')

      if (isBankDepositFrozen(deposit)) {
        throw new ConflictError(
          `Deposit ${deposit.number ?? depositId} is matched to bank line ` +
            `${deposit.bankTransactionId ?? '(cleared)'} and cannot be edited. Reverse its ` +
            'posting and regroup the payments instead - a reconciled month must not change ' +
            'underneath the person who signed it off.',
          { bankTransactionId: deposit.bankTransactionId ?? '' }
        )
      }

      const values: Record<string, unknown> = {}
      if (depositDate !== undefined && depositDate !== deposit.depositDate) {
        assertIsoDate(depositDate, 'Deposit date')
        if (deposit.glPostingId) {
          throw new ConflictError(
            `Deposit ${deposit.number ?? depositId} has already posted, so its date is the ` +
              'accounting date of an immutable entry. Reverse the posting and regroup to ' +
              'change it.',
            { glPostingId: deposit.glPostingId }
          )
        }
        values.bank_deposit_date = depositDate
      }
      if (bankAccountId !== undefined && bankAccountId.trim() !== deposit.bankAccountId) {
        if (!bankAccountId.trim()) {
          throw new BadRequestError('A deposit must name the bank account the money lands in')
        }
        if (deposit.glPostingId) {
          const label = deposit.bankAccountGlAccountId
            ? await describeDebitAccount(db, organizationId, deposit.bankAccountGlAccountId)
            : 'its bank account'
          throw new ConflictError(
            `Deposit ${deposit.number ?? depositId} has already posted to ${label}, and that ` +
              'account is the debit leg of an immutable entry. Reverse the posting and regroup ' +
              'to bank it elsewhere.',
            { glPostingId: deposit.glPostingId }
          )
        }
        // Only reachable before the entry posts, so the id has nothing frozen
        // to disagree with yet and both halves move together. After it posts the
        // branch above refuses, which is what keeps them from ever diverging.
        const account = await requireDepositTarget(db, organizationId, bankAccountId.trim())
        values.bank_deposit_bank_account_record = account.recordId
        values.bank_deposit_bank_account = account.glAccountId
      }
      if (reference !== undefined) values.bank_deposit_reference = reference.trim() || null

      if (Object.keys(values).length > 0) {
        const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
        await crud.update(deposit.recordId, values)
      }

      const settled = await readBankDepositDetail(db, organizationId, depositId)
      return settled ?? deposit
    },
    'Failed to update bank deposit',
    { organizationId, depositId }
  )
}

/**
 * Whether this org has the `bank_deposit` entity at all - the Banking tab's gate.
 *
 * A cheap `null` check rather than a list read, so the nav can hide a surface
 * that would 500 on an org short of entity migration 125.
 */
export async function hasBankDeposits(organizationId: string): Promise<boolean> {
  return (await loadBankDepositFieldContext(organizationId)) != null
}

/** Re-exported so the router can type its `post` field without reaching into `postings`. */
export type { PostResult }

/**
 * Take every payment back out of a deposit, returning how many were unlinked.
 *
 * Kept for the "un-group" action the deposits page still owes (§5 of the
 * handoff); today only {@link rollbackDeposit} unlinks, and it unlinks the
 * payments it already holds in memory rather than re-reading them.
 *
 * 🛑 It goes through `UnifiedCrudHandler.update(..., { payment_bank_deposit:
 * null })`, one payment at a time, exactly as the rollback path does. The
 * earlier version issued a raw `DELETE FROM "FieldValue"`, which is the same
 * shape as the write and a completely different event: no field hooks, no
 * `record:updated`, no org-cache invalidation - the payment would read as
 * un-banked in the database and as banked in every cache and every subscriber
 * that had already seen it, with nothing to reconcile the two.
 *
 * 🛑 It refuses a deposit that has POSTED. Unlinking the payments of a posted
 * deposit leaves `Dr <bank> Cr undeposited_funds` in the books with nothing
 * behind it, and lets the same cheques be banked a second time - cash counted
 * twice, both entries balanced. Reverse the posting first (ground rule 6).
 */
export async function unlinkPaymentsFromDeposit(
  db: Database,
  params: { organizationId: string; actorUserId: string; depositId: string }
): Promise<Result<number, Error>> {
  const { organizationId, actorUserId, depositId } = params

  return guard(
    async () => {
      const deposit = await readBankDepositDetail(db, organizationId, depositId)
      if (!deposit) throw new UnprocessableEntityError('That bank deposit does not exist')

      if (isBankDepositFrozen(deposit)) {
        throw new ConflictError(
          `Deposit ${deposit.number ?? depositId} is matched to bank line ` +
            `${deposit.bankTransactionId ?? '(cleared)'} and its payments cannot be released.`,
          { bankTransactionId: deposit.bankTransactionId ?? '' }
        )
      }
      if (deposit.glPostingId) {
        throw new ConflictError(
          `Deposit ${deposit.number ?? depositId} has already posted. Reverse entry ` +
            `${deposit.glPostingId} before releasing its payments - unlinking them now would ` +
            'leave the entry in the books and let the same money be banked twice.',
          { glPostingId: deposit.glPostingId }
        )
      }

      const crud = new UnifiedCrudHandler(organizationId, actorUserId, db)
      for (const payment of deposit.payments) {
        await crud.update(payment.recordId, { payment_bank_deposit: null })
      }

      logger.info('Released the payments of a bank deposit', {
        organizationId,
        depositId,
        payments: deposit.payments.length,
      })
      return deposit.payments.length
    },
    'Failed to unlink payments from a bank deposit',
    { organizationId, depositId }
  )
}
