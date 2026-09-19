// packages/lib/src/accounting/money/checkout/deposit-accounting.ts

/**
 * A quote deposit collected online: money in, nothing relieved yet.
 *
 * ```
 *   Dr <the cash endpoint — the gateway's clearing account>
 *       Cr customer_deposits
 * ```
 *
 * 🔑 Why this is not `invoice-payments/receipt-accounting.ts`: a deposit is taken
 * before any invoice exists, so there is no receivable to relieve. The money is a
 * LIABILITY until an invoice is raised, and `invoice-payments/apply-money.ts` is
 * what later moves it out of `customer_deposits` into A/R.
 *
 * Subject the `MoneyTransaction`, parent the quote, counterparty the customer.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { toLedgerMinor } from '../../ledger/builders/basis-hash'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import type { GlPostingLineInput } from '../../ledger/types'
import { type MovementPostingResult, postMovementEntry } from '../post-movement'

export interface AcceptQuoteDepositInput {
  organizationId: string
  /** The `MoneyTransaction` to post. Must be a `customer_receipt`. */
  moneyTransactionId: string
  /** The document the held money is filed under - the quote, or the invoice it overpaid. */
  parentKind: 'quote' | 'invoice'
  parentInstanceId: string
  actorUserId?: string
}

/** Post one held quote deposit. Never throws - a refusal is a `blocked` result. */
export async function acceptQuoteDepositAccounting(
  db: Database,
  input: AcceptQuoteDepositInput
): Promise<MovementPostingResult> {
  return postMovementEntry(db, {
    organizationId: input.organizationId,
    moneyTransactionId: input.moneyTransactionId,
    purpose: 'customer_receipt',
    avenue: 'receipt',
    label: 'Quote deposit',
    actorUserId: input.actorUserId,
    prepare: async (_tx, loaded) => {
      const endpoint = await loaded.endpoint()
      const amount = toLedgerMinor(loaded.money.amountMinor, 'USD', 2)
      const memo = 'Quote deposit received'
      const lines: GlPostingLineInput[] = [
        {
          ...loaded.base,
          glAccountId: endpoint.glAccountId,
          direction: 'debit',
          amount,
          sortOrder: 0,
          memo,
        },
        {
          ...loaded.base,
          accountRole: ACCOUNT_ROLES.CUSTOMER_DEPOSITS,
          direction: 'credit',
          amount,
          sortOrder: 1,
          memo,
        },
      ]
      return { lines, parent: { sourceKind: input.parentKind, sourceId: input.parentInstanceId } }
    },
  })
}
