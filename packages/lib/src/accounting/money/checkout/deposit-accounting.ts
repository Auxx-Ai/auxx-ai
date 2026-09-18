// packages/lib/src/accounting/money/checkout/deposit-accounting.ts

/**
 * A quote deposit collected online: money in, nothing relieved yet.
 *
 * ```
 *   Dr <the gateway's clearing account>
 *       Cr customer_deposits
 * ```
 *
 * 🔑 Why this is not `invoices/receipt-accounting.ts`: a deposit is taken before
 * any invoice exists, so there is no receivable to relieve. The money is a
 * LIABILITY until an invoice is raised, and `invoices/apply-money.ts` is what
 * later moves it out of `customer_deposits` into A/R.
 *
 * Subject the `MoneyTransaction`, parent the quote, counterparty the customer,
 * `railId` the gateway (TARGET §5).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { ACCOUNT_ROLES, buildEntry } from '../../ledger/builders/entry'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { periodKeyForDate } from '../../ledger/periods/periods'
import { readAutoPostMode } from '../../ledger/post/auto-post'
import { postEntry } from '../../ledger/post/post-entry'
import { findLiveSubjectPosting } from '../../ledger/reads/list-postings'
import { isAccountingEnabled } from '../../ledger/setup/accounting-enabled'
import type { GlPostingLineInput, GlPostingSourceInput, PostResult } from '../../ledger/types'
import { getPaymentGateway } from '../../rails/reads'

const logger = createScopedLogger('quote-deposit-accounting')

export interface AcceptQuoteDepositInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  /** The document the held money is filed under - the quote, or the invoice it overpaid. */
  parentKind: 'quote' | 'invoice'
  parentInstanceId: string
  /** The `payment_gateway` the money arrived through. */
  railId: string
  actorUserId?: string
}

/** Post one held quote deposit. Never throws - a refusal is a {@link PostResult}. */
export async function acceptQuoteDepositAccounting(
  db: Database,
  input: AcceptQuoteDepositInput
): Promise<PostResult> {
  if (!(await isAccountingEnabled(db, input.organizationId))) return { status: 'not_enabled' }

  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (live.isOk() && live.value) return { status: 'already_posted', glPostingId: live.value.id }

  let entry: ReturnType<typeof buildEntry>
  let sources: GlPostingSourceInput[]
  try {
    const money = await db.query.MoneyTransaction.findFirst({
      where: and(
        eq(schema.MoneyTransaction.organizationId, input.organizationId),
        eq(schema.MoneyTransaction.id, input.moneyTransactionId),
        eq(schema.MoneyTransaction.purpose, 'customer_receipt')
      ),
    })
    if (!money || money.currency !== 'USD' || money.currencyExponent !== 2)
      throw new UnprocessableEntityError('A quote deposit requires a confirmed USD receipt')

    const zone = await getOrganizationSetting({
      organizationId: input.organizationId,
      key: 'accounting.bookTimeZone',
    })
    if (typeof zone !== 'string' || !zone)
      throw new UnprocessableEntityError('Book time zone is not configured')
    const txnDate = money.occurredAt
      ? periodKeyForDate(money.occurredAt, 'day', zone)
      : money.occurredOn!

    const gateway = await getPaymentGateway(db, input.organizationId, input.railId)
    if (gateway.isErr()) throw new UnprocessableEntityError(gateway.error.message)
    const clearingGlAccountId = gateway.value?.clearingGlAccountId?.trim()
    if (!clearingGlAccountId)
      throw new UnprocessableEntityError('That payment gateway names no clearing account')

    const amount = toLedgerMinor(money.amountMinor, 'USD', 2)
    const base = {
      sourceType: 'money_transaction',
      sourceId: money.id,
      ...(money.partyInstanceId
        ? { counterpartyType: 'customer' as const, counterpartyId: money.partyInstanceId }
        : {}),
    }
    const lines: GlPostingLineInput[] = [
      {
        ...base,
        glAccountId: clearingGlAccountId,
        direction: 'debit',
        amount,
        sortOrder: 0,
        memo: 'Quote deposit received',
      },
      {
        ...base,
        accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
        direction: 'credit',
        amount,
        sortOrder: 1,
        memo: 'Quote deposit received',
      },
    ]
    entry = buildEntry({ postingType: 'payment', periodKey: txnDate, txnDate, lines })
    sources = [
      { sourceKind: 'money_transaction', sourceId: money.id, linkRole: 'subject' },
      { sourceKind: input.parentKind, sourceId: input.parentInstanceId, linkRole: 'parent' },
      ...(money.partyInstanceId
        ? [
            {
              sourceKind: 'contact',
              sourceId: money.partyInstanceId,
              linkRole: 'counterparty' as const,
            },
          ]
        : []),
    ]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('A quote deposit was not posted to the ledger', {
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      error: message,
    })
    return {
      status: 'error',
      failureClass: error instanceof AuxxError ? 'data' : 'transport',
      retryable: false,
      error: message,
    }
  }

  const lock = await resolvePeriodLock(input.organizationId)
  return postEntry(db, {
    organizationId: input.organizationId,
    entry,
    actorUserId: input.actorUserId,
    lock,
    memo: `Quote deposit - movement ${input.moneyTransactionId}`,
    sources,
    railId: input.railId,
    scope: { rail: input.railId },
    mode: await readAutoPostMode(input.organizationId, 'receipt'),
  })
}
