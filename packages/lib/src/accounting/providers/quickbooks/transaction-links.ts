// packages/lib/src/accounting/providers/quickbooks/transaction-links.ts
// How a provider-authored Payment or Deposit names what it settles (brief 102 M3). The
// GeneralLedger report carries no `LinkedTxn`, so the matcher reads the object itself.

import type { ProviderTransactionLinks } from '../provider'
import type { QuickbooksToolContext } from './invoke-quickbooks-tool'

const TOOL_GET_PAYMENT = 'get_quickbooks_payment'
const TOOL_GET_DEPOSIT = 'get_quickbooks_deposit'

interface PaymentOutput {
  linkedInvoiceIds?: string[]
}

interface DepositOutput {
  status: 'Found' | 'NotFound'
  lines?: Array<{
    amount: number
    accountId: string | null
    linkedTxns: Array<{ txnId: string; txnType: string }>
  }>
}

type LinkReader = (
  context: QuickbooksToolContext,
  txnId: string
) => Promise<ProviderTransactionLinks | null>

/** Keyed by the report's transaction label, the spelling `ProviderLedgerEntry` stores. */
export const TRANSACTION_LINK_READERS: Record<string, LinkReader> = {
  Payment: async (context, txnId) => {
    const payment = (await context.callTool(TOOL_GET_PAYMENT, {
      paymentId: txnId,
    })) as PaymentOutput
    return {
      linked: (payment.linkedInvoiceIds ?? []).map((id) => ({ txnType: 'Invoice', txnId: id })),
      codedLines: [],
    }
  },
  Deposit: async (context, txnId) => {
    const deposit = (await context.callTool(TOOL_GET_DEPOSIT, {
      depositId: txnId,
    })) as DepositOutput
    if (deposit.status !== 'Found') return null
    const lines = deposit.lines ?? []
    return {
      linked: lines.flatMap((line) => line.linkedTxns),
      codedLines: lines.flatMap((line) =>
        line.accountId
          ? [{ providerAccountId: line.accountId, amountMinor: Math.round(line.amount * 100) }]
          : []
      ),
    }
  },
}
