// packages/lib/src/accounting/reports/general-ledger-csv.ts
//
// The general ledger as a CSV, built from the full read rather than from the
// rows the screen happens to have loaded (108 §3.2).

import type { Database } from '@auxx/database'
import { toCsv } from '@auxx/utils/csv'
import { err, ok, type Result } from 'neverthrow'
import {
  type GeneralLedgerSource,
  readGeneralLedgerLines,
  readGeneralLedgerSummary,
} from './general-ledger-pages'

export interface ReadGeneralLedgerCsvOptions {
  organizationId: string
  from: string
  to: string
  glAccountId?: string
  source?: GeneralLedgerSource
  search?: string
  /** ISO 4217, for the minor-unit exponent. */
  currencyCode?: string
}

const HEADERS = [
  'Account',
  'Date',
  'Type',
  'Number',
  'Name',
  'Memo',
  'Split',
  'Debit',
  'Credit',
  'Balance',
]

/** Every line in the range, one account after another, with opening and ending rows. */
export async function readGeneralLedgerCsv(
  db: Database,
  options: ReadGeneralLedgerCsvOptions
): Promise<Result<string, Error>> {
  const summary = await readGeneralLedgerSummary(db, options)
  if (summary.isErr()) return err(summary.error)

  const money = moneyFormatter(options.currencyCode ?? 'USD')
  const records: Array<Record<string, string>> = []

  for (const account of summary.value.accounts) {
    records.push({
      Account: account.label,
      Memo: 'Opening balance',
      Balance: money(account.openingBalanceMinor),
    })

    const lines = await readGeneralLedgerLines(db, {
      organizationId: options.organizationId,
      glAccountId: account.glAccountId,
      from: options.from,
      to: options.to,
      source: options.source,
      search: options.search,
      offset: 0,
    })
    if (lines.isErr()) return err(lines.error)

    for (const line of lines.value) {
      records.push({
        Account: account.label,
        Date: line.txnDate,
        Type: humanize(line.postingType),
        Number: line.docNumber,
        Name: line.counterpartyName ?? '',
        Memo: line.memo ?? '',
        Split: line.splitLabel ?? '',
        Debit: line.direction === 'debit' ? money(line.amountMinor) : '',
        Credit: line.direction === 'credit' ? money(line.amountMinor) : '',
        Balance: money(line.runningBalanceMinor),
      })
    }

    records.push({
      Account: account.label,
      Memo: 'Ending balance',
      Debit: money(account.debitMinor),
      Credit: money(account.creditMinor),
      Balance: money(account.endingBalanceMinor),
    })
  }

  records.push({
    Account: 'Total',
    Debit: money(summary.value.totalDebitMinor),
    Credit: money(summary.value.totalCreditMinor),
  })

  return ok(toCsv(records, HEADERS))
}

function humanize(postingType: string): string {
  const words = postingType.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Plain major-unit decimals, as `toCsvRows` writes them: a spreadsheet cannot sum `$1,234.56`. */
function moneyFormatter(currencyCode: string): (minor: number) => string {
  let exponent = 2
  try {
    exponent =
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
      }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    exponent = 2
  }
  return (minor) => (minor / 10 ** exponent).toFixed(exponent)
}
