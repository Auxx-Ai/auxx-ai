// packages/lib/src/postings/provider-sync/__tests__/support/fixtures.ts
//
// Hand-built stand-ins for the 2026-09-10 sandbox general ledger. Not the real
// fixture (that lives in the apps repo, where the mapper that produces these
// rows is tested against it) - these are the same SHAPE at the same counts, so
// a planner test can assert the structural facts the spike established without
// a 368 KB blob or a connection.

import type { OurPostedEntry, ProviderLedger, ProviderLedgerLine } from '../../client'

/** The 17 transaction types the sandbox renders, verbatim (§4.5). */
export const TXN_TYPES = [
  'Journal Entry',
  'Credit Card Expense',
  'Bill Payment',
  'Check',
  'Invoice',
  'Payment',
  'Deposit',
  'Expense',
  'Bill',
  'Sales Receipt',
  'Transfer',
  'Refund',
  'Credit Memo',
  'Vendor Credit',
  'Inventory Qty Adjust',
  'Purchase Order',
  'Estimate',
] as const

export function line(over: Partial<ProviderLedgerLine> = {}): ProviderLedgerLine {
  return {
    txnType: 'Journal Entry',
    txnId: '1',
    txnDate: '2026-02-15',
    providerAccountId: '35',
    providerAccountName: 'Checking',
    debitMinor: 0,
    creditMinor: 0,
    docNumber: null,
    memo: null,
    ...over,
  }
}

export function ledger(
  lines: ProviderLedgerLine[],
  over: Partial<ProviderLedger> = {}
): ProviderLedger {
  return {
    from: '2026-02-01',
    to: '2026-02-28',
    currency: 'USD',
    hasData: true,
    lines,
    ...over,
  }
}

/** How the sandbox names the provider accounts these fixtures use. */
export const PROVIDER_ACCOUNT_NAMES: Record<string, string> = {
  '35': 'Checking',
  '41': 'Mastercard',
  '60': 'Rent',
  '61': 'Utilities',
  '90': 'Inventory Asset',
}

/** A two-line entry: `Dr <debit account> / Cr <credit account>` for `amount`. */
export function balancedEntryLines(input: {
  txnType: string
  txnId: string
  txnDate?: string
  amount: number
  debitAccountId?: string
  creditAccountId?: string
  docNumber?: string | null
}): ProviderLedgerLine[] {
  const shared = {
    txnType: input.txnType,
    txnId: input.txnId,
    txnDate: input.txnDate ?? '2026-02-15',
    docNumber: input.docNumber ?? null,
  }
  const debitAccountId = input.debitAccountId ?? '41'
  const creditAccountId = input.creditAccountId ?? '35'
  return [
    line({
      ...shared,
      providerAccountId: debitAccountId,
      providerAccountName: PROVIDER_ACCOUNT_NAMES[debitAccountId] ?? debitAccountId,
      debitMinor: input.amount,
    }),
    line({
      ...shared,
      providerAccountId: creditAccountId,
      providerAccountName: PROVIDER_ACCOUNT_NAMES[creditAccountId] ?? creditAccountId,
      creditMinor: input.amount,
    }),
  ]
}

/**
 * A ledger the same shape as the sandbox fixture: **336 lines, 128
 * transactions, all balanced**, with 9 rows carrying no money in either column
 * (the Inventory Qty Adjust legs - §4.7, and the correction that says dropping
 * them deletes four whole transactions).
 *
 * 88 two-line transactions + 40 four-line ones = 336 rows.
 */
export function sandboxShapedLedger(): ProviderLedger {
  const lines: ProviderLedgerLine[] = []
  let id = 1

  for (let i = 0; i < 88; i += 1) {
    const txnType = i < 4 ? 'Inventory Qty Adjust' : TXN_TYPES[i % TXN_TYPES.length]!
    // The first four carry no money at all, on BOTH legs.
    const amount = i < 4 ? 0 : (i + 1) * 100
    lines.push(
      ...balancedEntryLines({
        txnType,
        txnId: String(id),
        amount,
        debitAccountId: '41',
        creditAccountId: '35',
      })
    )
    id += 1
  }

  for (let i = 0; i < 40; i += 1) {
    const txnType = TXN_TYPES[(i + 3) % TXN_TYPES.length]!
    const txnId = String(id)
    const shared = { txnType, txnId, txnDate: '2026-02-20' }
    if (i === 0) {
      // One four-line transaction whose fourth row is the ninth zero row.
      lines.push(
        line({
          ...shared,
          providerAccountId: '60',
          providerAccountName: 'Rent',
          debitMinor: 30000,
        }),
        line({
          ...shared,
          providerAccountId: '35',
          providerAccountName: 'Checking',
          creditMinor: 15000,
        }),
        line({
          ...shared,
          providerAccountId: '41',
          providerAccountName: 'Mastercard',
          creditMinor: 15000,
        }),
        line({ ...shared, providerAccountId: '90', providerAccountName: 'Inventory Asset' })
      )
    } else {
      lines.push(
        line({ ...shared, providerAccountId: '60', providerAccountName: 'Rent', debitMinor: 200 }),
        line({
          ...shared,
          providerAccountId: '61',
          providerAccountName: 'Utilities',
          debitMinor: 300,
        }),
        line({
          ...shared,
          providerAccountId: '35',
          providerAccountName: 'Checking',
          creditMinor: 400,
        }),
        line({
          ...shared,
          providerAccountId: '41',
          providerAccountName: 'Mastercard',
          creditMinor: 100,
        })
      )
    }
    id += 1
  }

  return ledger(lines)
}

/** One of our own posted entries, in the shape the comparison takes. */
export function ourEntry(over: Partial<OurPostedEntry> = {}): OurPostedEntry {
  return {
    glPostingId: 'post_1',
    providerEntryId: '6',
    docNumber: 'AUXX-JNL-JE0007',
    txnDate: '2026-02-15',
    lines: [
      {
        glAccountId: 'gl_mastercard',
        accountCode: '2100',
        accountName: 'Mastercard',
        direction: 'debit',
        amountMinor: 90000,
      },
      {
        glAccountId: 'gl_checking',
        accountCode: '1010',
        accountName: 'Checking',
        direction: 'credit',
        amountMinor: 90000,
      },
    ],
    ...over,
  }
}

/** `glAccountId -> providerAccountId`, matching {@link ourEntry}'s two accounts. */
export function accountMap(): Map<string, string> {
  return new Map([
    ['gl_mastercard', '41'],
    ['gl_checking', '35'],
    ['gl_rent', '60'],
    ['gl_utilities', '61'],
    ['gl_inventory', '90'],
  ])
}
