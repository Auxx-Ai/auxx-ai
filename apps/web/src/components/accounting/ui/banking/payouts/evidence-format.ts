// apps/web/src/components/accounting/ui/banking/payouts/evidence-format.ts

/** Format exact source minor units without rounding through a JavaScript number. */
export function formatEvidenceAmount(
  amountMinor: string,
  currencyCode: string,
  currencyExponent: number
): string {
  const amount = BigInt(amountMinor)
  const absolute = amount < 0n ? -amount : amount
  const digits = absolute.toString().padStart(currencyExponent + 1, '0')
  const whole = currencyExponent === 0 ? digits : digits.slice(0, -currencyExponent)
  const fraction = currencyExponent === 0 ? '' : `.${digits.slice(-currencyExponent)}`
  return `${currencyCode} ${amount < 0n ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`
}

/** Keep date-only evidence date-only and display timestamp evidence with its UTC zone. */
export function formatEvidenceDate(value: string | null): string {
  if (!value) return 'Not reported'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

/** The day only — the row line shows this and keeps the full value in its tooltip. */
export function formatEvidenceDay(value: string | null): string {
  if (!value) return 'Not reported'
  return formatEvidenceDate(value).slice(0, 10)
}
