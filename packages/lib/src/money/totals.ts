// packages/lib/src/money/totals.ts

import type { DiscountType, DocumentBillingInputs, DocumentTotals, LineForTotals } from './types'

/**
 * Round-half-up to 2 decimals. Applied per aggregate (subtotal, discountAmount,
 * taxTotal, total) — never to running intermediates like the pro-rata tax base.
 * The `Number.EPSILON` nudge counters float-representation error (e.g. `1.005 * 100`
 * naively evaluating to `100.49999999999999` and rounding down to `100`).
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * A single line's total: `qty * unitPrice`, rounded. A `null` `unitPrice` means the
 * line hasn't been priced yet — the totals engine writes `null` and every downstream
 * sum excludes it (money MQ1 build spec §F.1).
 */
export function computeLineTotal(qty: number, unitPrice: number | null): number | null {
  if (unitPrice === null) return null
  return round2(qty * unitPrice)
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
  return round2(clamp(raw, 0, subtotal))
}

/**
 * Pure, isomorphic document-totals math shared by the server recompute hook
 * (`totals-hooks.ts`) and the client-side optimistic footer (`@auxx/lib/money/client`).
 * No `Date`, no I/O — safe to call from either environment.
 *
 * Rules (money MQ1 build spec §F.1):
 * - `subtotal` = Σ lineTotal (nulls excluded)
 * - `discountAmount` = percent-of-subtotal or flat amount, clamped to `[0, subtotal]`
 * - tax base = the *taxable* share of the *discounted* subtotal, allocated pro-rata:
 *   `taxableSubtotal * (1 - discountAmount / subtotal)`
 * - `taxTotal` = `taxBase * taxRate / 100`
 * - `total` = `subtotal - discountAmount + taxTotal`
 */
export function computeDocumentTotals(
  lines: LineForTotals[],
  billing: DocumentBillingInputs
): DocumentTotals {
  const subtotal = round2(
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
  const taxTotal = round2(taxBase * (taxRate / 100))

  const total = round2(subtotal - discountAmount + taxTotal)

  return { subtotal, discountAmount, taxTotal, total }
}
