// packages/lib/src/sales/totals/totals.ts

import type { DiscountType, DocumentBillingInputs, DocumentTotals, LineForTotals } from '../types'

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
 * (`totals-hooks.ts`) and the client-side optimistic footer (`@auxx/lib/sales/client`).
 * No `Date`, no I/O — safe to call from either environment.
 *
 * Rules (money MQ1 build spec §F.1), all amounts in integer cents:
 * - `subtotal` = Σ lineTotal (nulls excluded)
 * - `discountAmount` = percent-of-subtotal or flat cents amount, clamped to `[0, subtotal]`
 * - tax base = the *taxable* share of the *discounted* subtotal, allocated pro-rata:
 *   `taxableSubtotal * (1 - discountAmount / subtotal)`
 * - `taxTotal` = `taxBase * taxRate / 100`
 * - `total` = `subtotal - discountAmount + taxTotal + shipping` (money plan 37 §6). `shipping`
 *   defaults to 0 when absent, so a caller that never sets it (quote, invoice) gets byte-for-byte
 *   the pre-shipping formula.
 *
 * Deselected options (money plan 18 §2) — a line with `optional: true` and
 * `optionalSelected: false` contributes nothing to `subtotal`, `taxableSubtotal`, or (by
 * extension) the discount/tax base. Absent/undefined flags are equivalent to a required line
 * and keep today's behavior byte-for-byte.
 */
export function computeDocumentTotals(
  lines: LineForTotals[],
  billing: DocumentBillingInputs
): DocumentTotals {
  const isExcluded = (line: LineForTotals): boolean =>
    line.optional === true && line.optionalSelected === false

  const subtotal = roundCents(
    lines.reduce(
      (sum, line) => (line.lineTotal === null || isExcluded(line) ? sum : sum + line.lineTotal),
      0
    )
  )
  const taxableSubtotal = lines.reduce(
    (sum, line) =>
      line.lineTotal === null || !line.taxable || isExcluded(line) ? sum : sum + line.lineTotal,
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

  const shipping = billing.shipping ?? 0
  const total = roundCents(subtotal - discountAmount + taxTotal + shipping)

  return { subtotal, discountAmount, taxTotal, total }
}

/** A line's total is in the header discount's base when it contributes to the subtotal. */
function contributes(line: LineForTotals): line is LineForTotals & { lineTotal: number } {
  return (
    line.lineTotal !== null &&
    line.lineTotal > 0 &&
    !(line.optional === true && line.optionalSelected === false)
  )
}

/**
 * Push a header discount DOWN onto the lines, pro rata by line total, so that
 * Σ net line totals is the discounted subtotal to the cent. The input
 * `lineTotal` is the GROSS (`line_item_line_total`); the output `lineTotal` is
 * the NET the `order` spec stores in `line_item_net_total` (29 §2.3). The
 * gross column itself is never rewritten.
 *
 * Largest remainder: each contributing line takes the floor of its exact share
 * (`discountAmount x lineTotal / subtotal`), and the cents the floors leave
 * over go one each to the lines with the largest fractional parts, earliest
 * line first on a tie. So 100.00 and 50.00 with 7.00 off split 4.67 / 2.33
 * (exact shares 4.666 / 2.333, the odd cent to the first) and net to
 * 95.33 / 47.67, which is 143.00 exactly. A percent discount that divides
 * evenly, 10% off the same two lines, is 90.00 / 45.00 with nothing to hand
 * out.
 *
 * Lines that do not contribute to the subtotal - unpriced (`null`), zero, or a
 * deselected option - carry no share and come back as they went in. The
 * discount itself is `computeDocumentTotals`' own figure (percent of the
 * subtotal or a flat amount, clamped to `[0, subtotal]`), so the two never
 * disagree about how much is being allocated.
 *
 * Generic over the line shape so a caller's own fields (an instance id, the
 * stored total) survive the round trip.
 *
 * @see plans/accounting/tasks/29-clearing-at-the-payment-date.md §12 item 7
 */
export function allocateDiscountToLines<L extends LineForTotals>(
  lines: L[],
  billing: Pick<DocumentBillingInputs, 'discountType' | 'discountValue'>
): { lines: L[]; discountAmount: number } {
  const subtotal = roundCents(
    lines.reduce((sum, line) => (contributes(line) ? sum + line.lineTotal : sum), 0)
  )
  const discountAmount = computeDiscountAmount(
    subtotal,
    billing.discountType,
    billing.discountValue
  )
  if (discountAmount === 0 || subtotal <= 0) return { lines: [...lines], discountAmount }

  const shares = lines.map((line) => {
    if (!contributes(line)) return null
    const exact = (discountAmount * line.lineTotal) / subtotal
    const floor = Math.floor(exact)
    return { floor, fraction: exact - floor }
  })
  let remainder = discountAmount - shares.reduce((sum, share) => sum + (share?.floor ?? 0), 0)

  // The odd cents, to the largest fractional parts first. A stable sort on the
  // index keeps a tie deterministic: the earlier line takes the cent.
  const byFraction = shares
    .map((share, index) => ({ share, index }))
    .filter((entry) => entry.share !== null)
    .sort((a, b) => (b.share?.fraction ?? 0) - (a.share?.fraction ?? 0) || a.index - b.index)
  const bumped = new Set<number>()
  for (const entry of byFraction) {
    if (remainder <= 0) break
    bumped.add(entry.index)
    remainder--
  }

  return {
    discountAmount,
    lines: lines.map((line, index) => {
      const share = shares[index]
      if (share === null || share === undefined || !contributes(line)) return line
      const allocated = share.floor + (bumped.has(index) ? 1 : 0)
      return { ...line, lineTotal: line.lineTotal - allocated }
    }),
  }
}

/**
 * {@link computeDocumentTotals} for a document whose header discount lives ON
 * THE LINES: the discount is allocated first ({@link allocateDiscountToLines}),
 * and the totals are then computed over the NET lines with no header discount
 * left to subtract. `discountAmount` still reports what was allocated, so a
 * footer can show it.
 *
 * The consequence, and the reason this exists: `subtotal` is Σ net line totals,
 * the tax base is the net taxable lines directly (no `(1 - discount/subtotal)`
 * factor, because the discount is already in the lines), and
 * `total = subtotal + tax + shipping`. That is the shape a connector-synced
 * order already has - Shopify's `subtotal_price` is net of every discount and
 * its `line_item_net_total` carries each line's allocations - so a native
 * order with a header discount stops being the one document family whose
 * Σ line nets differs from its subtotal (29 §1.7, §2.3, §12 item 7).
 */
export function computeAllocatedDocumentTotals<L extends LineForTotals>(
  lines: L[],
  billing: DocumentBillingInputs
): { totals: DocumentTotals; lines: L[] } {
  const allocated = allocateDiscountToLines(lines, billing)
  const totals = computeDocumentTotals(allocated.lines, {
    ...billing,
    discountType: null,
    discountValue: null,
  })
  return { totals: { ...totals, discountAmount: allocated.discountAmount }, lines: allocated.lines }
}
