// packages/lib/src/money/totals.ts

import type { DiscountType, DocumentBillingInputs, DocumentTotals, LineForTotals } from './types'

/**
 * All monetary amounts flow through this module as INTEGER CENTS — the platform
 * `FieldType.CURRENCY` storage convention (`DisplayCurrency` renders `value / 100`).
 * Percent inputs (`discountValue` with `discountType: 'percent'`, `taxRate`) are
 * plain percentages; a `discountType: 'amount'` `discountValue` is cents.
 *
 * Round-half-up to a whole cent. Applied per aggregate (lineTotal, subtotal,
 * discountAmount, taxTotal, total) — never to running intermediates like the
 * pro-rata tax base. The `Number.EPSILON` nudge counters float-representation
 * error in half-cent cases.
 */
export function roundCents(value: number): number {
  return Math.round(value + Number.EPSILON)
}

/**
 * A single line's total in cents: `qty * unitPrice`, rounded to a whole cent
 * (fractional quantities can produce fractional cents). A `null` `unitPrice`
 * means the line hasn't been priced yet — the totals engine writes `null` and
 * every downstream sum excludes it (money MQ1 build spec §F.1).
 */
export function computeLineTotal(qty: number, unitPrice: number | null): number | null {
  if (unitPrice === null) return null
  return roundCents(qty * unitPrice)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function computeDiscountAmount(
  subtotal: number,
  discountType: DiscountType | null | undefined,
  discountValue: number | null | undefined
): number {
  if (!discountType || !discountValue) return 0
  const raw = discountType === 'percent' ? subtotal * (discountValue / 100) : discountValue
  return roundCents(clamp(raw, 0, subtotal))
}

/**
 * Pure, isomorphic document-totals math shared by the server recompute hook
 * (`totals-hooks.ts`) and the client-side optimistic footer (`@auxx/lib/money/client`).
 * No `Date`, no I/O — safe to call from either environment.
 *
 * Rules (money MQ1 build spec §F.1), all amounts in integer cents:
 * - `subtotal` = Σ lineTotal (nulls excluded)
 * - `discountAmount` = percent-of-subtotal or flat cents amount, clamped to `[0, subtotal]`
 * - tax base = the *taxable* share of the *discounted* subtotal, allocated pro-rata:
 *   `taxableSubtotal * (1 - discountAmount / subtotal)`
 * - `taxTotal` = `taxBase * taxRate / 100`
 * - `total` = `subtotal - discountAmount + taxTotal`
 */
export function computeDocumentTotals(
  lines: LineForTotals[],
  billing: DocumentBillingInputs
): DocumentTotals {
  const subtotal = roundCents(
    lines.reduce((sum, line) => (line.lineTotal === null ? sum : sum + line.lineTotal), 0)
  )
  const taxableSubtotal = lines.reduce(
    (sum, line) => (line.lineTotal === null || !line.taxable ? sum : sum + line.lineTotal),
    0
  )

  const discountAmount = computeDiscountAmount(
    subtotal,
    billing.discountType,
    billing.discountValue
  )

  const taxRate = billing.taxRate ?? 0
  const taxBase = subtotal > 0 ? taxableSubtotal * (1 - discountAmount / subtotal) : 0
  const taxTotal = roundCents(taxBase * (taxRate / 100))

  const total = roundCents(subtotal - discountAmount + taxTotal)

  return { subtotal, discountAmount, taxTotal, total }
}
