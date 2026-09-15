// apps/web/src/components/accounting/ui/banking/settlements/settlement-display.ts
import { minorUnitExponent } from '@auxx/utils/currency'

interface SettlementRow {
  depositedMinor: number
  currency: string | null
  status: string
  sourceSummary?: {
    amountMinor: string | null
    currency: string | null
    currencyExponent: number | null
    status: string | null
  } | null
}

/** Prefer reported payout facts without treating missing amounts as zero. */
export function settlementDisplay(row: SettlementRow) {
  if (row.sourceSummary)
    return {
      ...row.sourceSummary,
      status: row.sourceSummary.status ?? 'Not reported',
    }
  const currency = row.currency ?? 'USD'
  return {
    amountMinor: Number.isSafeInteger(row.depositedMinor) ? String(row.depositedMinor) : null,
    currency,
    currencyExponent: minorUnitExponent(currency),
    status: row.status,
  }
}

/** Sum paid payouts exactly, keeping currencies separate and excluding unknown amounts. */
export function settlementDepositTotals(rows: SettlementRow[]) {
  const totals = new Map<
    string,
    { amountMinor: string; currency: string; currencyExponent: number }
  >()
  for (const row of rows) {
    const value = settlementDisplay(row)
    if (
      value.status !== 'paid' ||
      value.amountMinor === null ||
      !value.currency ||
      value.currencyExponent === null
    )
      continue
    const previous = totals.get(value.currency)
    totals.set(value.currency, {
      amountMinor: (BigInt(previous?.amountMinor ?? '0') + BigInt(value.amountMinor)).toString(),
      currency: value.currency,
      currencyExponent: value.currencyExponent,
    })
  }
  return [...totals.values()]
}
