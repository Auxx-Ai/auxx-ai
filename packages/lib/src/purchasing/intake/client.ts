// packages/lib/src/purchasing/intake/client.ts

// The intake contract: every type that crosses between the transcriber, the
// resolver, the draft store, the router and the review screen lives here.
//
// ⚠️ No `'use client'` directive — server code imports this file too, and the
// directive would turn every export into a client-reference proxy there
// (docs/lib-module-guide.md §7).

import type { RecordId } from '@auxx/types/resource'
import { parseMajorToMinor, RATE_DECIMALS } from '@auxx/utils/currency'

// ── Tiers ────────────────────────────────────────────────────────────────────

/**
 * How a printed line code was matched to one of our parts.
 *
 * 🛑 The order is the order the DATA supports, not the order that reads best.
 * `vendor_sku` is the strongest match and `sku` the second, but today 4 of 206
 * `vendor_part` rows carry a `vendorSku` while all 257 parts carry a `sku`, so
 * `sku` is what actually fires (plans/money/tasks/38 §0). Confirming a match
 * writes the vendor's code back, which is what eventually makes `vendor_sku`
 * primary — see `IntakeCommitInput.writeBacks`.
 */
export const INTAKE_TIERS = ['vendor_sku', 'sku', 'fuzzy', 'none'] as const
export type IntakeTier = (typeof INTAKE_TIERS)[number]

/**
 * Tiers that may link a line without a human touching it.
 *
 * 🛑 `fuzzy` is deliberately absent and must never be added. A normalized title
 * match is a suggestion; auto-linking one puts a part nobody chose onto a line
 * that becomes a real order.
 */
export const AUTO_LINK_TIERS: readonly IntakeTier[] = ['vendor_sku', 'sku']

export function isAutoLinkTier(tier: IntakeTier): boolean {
  return AUTO_LINK_TIERS.includes(tier)
}

/** Human label for a tier badge. `vendor_sku` and `sku` must not read alike. */
export const INTAKE_TIER_LABELS: Record<IntakeTier, string> = {
  vendor_sku: 'Vendor SKU',
  sku: 'Our SKU',
  fuzzy: 'Review',
  none: 'No match',
}

// ── What the model transcribes ───────────────────────────────────────────────

/**
 * One quantity break as the vendor printed it.
 *
 * "100 @ $4.20 / 500 @ $3.90" is standard on a quote and a purchase order line
 * has exactly one `expectedUnitPrice`, so the breaks are carried as data and
 * shown, rather than silently collapsed to whichever one the model liked.
 */
export interface TranscribedPriceBreak {
  minQuantity: number
  /** As printed, in major units — `'3.90'`. Parsed once, server-side. */
  unitPriceText: string | null
}

/**
 * One line of the vendor's document, as printed.
 *
 * 🛑 Every money field is the vendor's own STRING. Transcribing `'1,234.56'` into
 * a float and back is how a price stops matching the paper it came from; the
 * conversion to minor units happens once, deterministically, in
 * `parseIntakeMoney`. Nothing here is ever computed — a line whose printed total
 * disagrees with quantity × price keeps both numbers and shows the disagreement.
 */
export interface TranscribedLine {
  lineNumber: number | null
  /** The vendor's own code for this item, as printed. The tier ladder's input. */
  vendorCode: string | null
  description: string | null
  quantity: number | null
  unit: string | null
  unitPriceText: string | null
  lineTotalText: string | null
  leadTime: string | null
  priceBreaks: TranscribedPriceBreak[]
}

/** The vendor's document as printed, and nothing else. */
export interface TranscribedQuote {
  vendorName: string | null
  vendorEmail: string | null
  vendorPhone: string | null
  vendorAddress: string | null
  quoteNumber: string | null
  /** ISO date as printed, or the raw string when it will not parse. */
  quoteDate: string | null
  validUntil: string | null
  /** ISO 4217, uppercased. `null` when the document names no currency. */
  currency: string | null
  subtotalText: string | null
  shippingText: string | null
  taxText: string | null
  /**
   * 🛑 The vendor's printed total, never a sum of the lines. When the two
   * disagree the review screen shows both — it is either their arithmetic (real,
   * keep it) or a line we failed to read (a defect a silent fix would hide).
   */
  totalText: string | null
  lines: TranscribedLine[]
}

// ── What the resolver decides ────────────────────────────────────────────────

/** One record the model or the ladder offered as a match. */
export interface IntakeCandidate {
  recordId: RecordId
  displayName: string
  /** SKU for a part, email for a contact — whatever disambiguates two same-named rows. */
  secondary: string | null
}

/** A part candidate, carrying the tier that produced it. */
export interface IntakePartCandidate extends IntakeCandidate {
  tier: IntakeTier
}

/** Where a line's amount went, when it is not an ordered part (§5.4). */
export type IntakeFold = 'shipping' | 'tax'

/**
 * One proposed purchase order line.
 *
 * 🛑 `partRecordId` is `null` on any line the ladder did not auto-link, and a
 * line may not be committed with it still `null`: `purchase_order_line.part` is
 * `required: true` and leg 2 of the natural key `(purchaseOrder, part)`. The
 * three legal endings for an unresolved row are pick a part, create one, or
 * `foldedInto` — never "commit it description-only".
 */
export interface IntakeLine {
  /** Stable for the life of the draft, so the review screen can key rows. */
  lineId: string
  printed: TranscribedLine
  tier: IntakeTier
  candidates: IntakePartCandidate[]
  partRecordId: RecordId | null
  /**
   * The supplier catalogue entry the price was seeded from — PROVENANCE, stamped
   * by the same prefill the line builder uses. Never re-read for a price.
   */
  vendorPartRecordId: RecordId | null
  description: string | null
  quantity: number
  /** Integer minor units. The vendor's printed price always wins over a prefill. */
  unitPriceCents: number | null
  /** Index into `printed.priceBreaks`, or `null` for the base printed price. */
  chosenBreakIndex: number | null
  /** Set instead of a part when the amount belongs on a header total (§5.4). */
  foldedInto: IntakeFold | null
}

/** The whole proposal, as stored under the draft's Redis key (plans/money/tasks/38 §6.1). */
export interface IntakeDraftPayload {
  transcription: TranscribedQuote
  /** The contact the quote came from, once resolved. `null` until somebody picks. */
  vendorRecordId: RecordId | null
  vendorCandidates: IntakeCandidate[]
  lines: IntakeLine[]
  /** ISO 4217 the draft commits in. Falls back to the org currency. */
  currency: string
  quoteNumber: string | null
  quoteDate: string | null
  expectedDeliveryDate: string | null
  /** Header totals, in integer minor units, after any §5.4 folds. */
  shippingCents: number
  taxCents: number
}

// ── Draft lifecycle ──────────────────────────────────────────────────────────

export const INTAKE_DRAFT_STATUSES = ['reading', 'ready', 'failed', 'committed'] as const
export type IntakeDraftStatus = (typeof INTAKE_DRAFT_STATUSES)[number]

/**
 * The read's phases, in order, as the dialog ticks them off.
 *
 * The dialog renders the whole list up front and marks each one done, so a
 * 40-second wait reads as progress rather than as a spinner.
 */
export const INTAKE_PHASES = ['document', 'vendor', 'lines', 'draft'] as const
export type IntakeDraftPhase = (typeof INTAKE_PHASES)[number]

export const INTAKE_PHASE_LABELS: Record<IntakeDraftPhase, string> = {
  document: 'Reading the document',
  vendor: 'Matching the vendor',
  lines: 'Matching lines to parts',
  draft: 'Drafting the order',
}

/** The draft as the review screen and the dialog read it. */
export interface IntakeDraftView {
  id: string
  status: IntakeDraftStatus
  phase: IntakeDraftPhase | null
  assetRef: string
  fileName: string | null
  mimeType: string | null
  payload: IntakeDraftPayload | null
  error: string | null
  purchaseOrderInstanceId: string | null
  createdAt: string
}

/**
 * The `localStorage` pointer the purchase orders page reads to show its banner.
 *
 * ⚠️ Device-local by design: the draft row is server-side because the worker
 * writes it while the tab may be closed, but nothing indexes "my open drafts".
 * Upload on the laptop and the draft is invisible on the phone. That is the
 * accepted trade for not building a `listDrafts` surface (§6.1).
 */
export const INTAKE_POINTER_STORAGE_KEY = 'auxx.purchasing.intake.drafts'

export interface IntakeDraftPointer {
  draftId: string
  vendorLabel: string | null
  startedAt: string
}

// ── Commit ───────────────────────────────────────────────────────────────────

/**
 * One accepted `vendorSku` write-back.
 *
 * 🛑 Offered per line and unchecked by default. A vendor's printed line code is
 * sometimes their order number rather than their part number, and writing that
 * as a `vendorSku` poisons every future tier-1 match. One blanket toggle would
 * force the person to gamble on all of them at once.
 */
export interface IntakeWriteBack {
  partRecordId: RecordId
  vendorSku: string
}

export interface IntakeCommitInput {
  draftId: string
  writeBacks: IntakeWriteBack[]
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * The one place a printed money string becomes minor units.
 *
 * 🛑 Every amount on a quote arrives as the vendor's own string — `'1,234.56'`,
 * `'€0.42'`, `'3.90'`. Parsing it twice, in two places, with two ideas about
 * thousands separators, is how the review screen and the committed order come to
 * disagree about a price. `parseMajorToMinor` already handles the symbol and
 * separator stripping and the per-currency exponent; this exists so that call is
 * made once and named.
 *
 * `null` for an unparseable or absent string — which is a real state on a quote
 * that prints "POA" against a line, not an error.
 */
export function parseIntakeMoney(
  text: string | null | undefined,
  currency: string,
  decimals: number | null = null
): number | null {
  if (text === null || text === undefined) return null
  const trimmed = text.trim()
  if (!trimmed) return null
  return parseMajorToMinor(trimmed, currency, decimals)
}

/**
 * A printed UNIT PRICE in minor units, at rate precision.
 *
 * 🛑 Not the same call as a total. `purchase_order_line_expected_unit_price` is a
 * RATE field carried at `RATE_DECIMALS` (5), and rounding a unit price to whole
 * minor units silently destroys the prices this feature exists to read: a
 * fastener vendor quoting `$15.94 per 1,000` means `0.01594` each, which rounds
 * to **2 cents** - a 25% error that looks like a plausible price. Label, resistor
 * and fastener catalogues are quoted exactly this way, so this is the common
 * case, not the exotic one.
 */
export function parseIntakeUnitPrice(
  text: string | null | undefined,
  currency: string
): number | null {
  return parseIntakeMoney(text, currency, RATE_DECIMALS)
}

/**
 * A printed TOTAL in minor units, at the currency's own exponent.
 *
 * Line totals, subtotals, shipping, tax and the document total are money, not
 * rates: the vendor printed them to the cent and storing more precision than
 * they printed would invent digits they did not write.
 */
export function parseIntakeTotal(text: string | null | undefined, currency: string): number | null {
  return parseIntakeMoney(text, currency)
}

/**
 * A line's unit price, in minor units, possibly FRACTIONAL.
 *
 * 🛑 Reads the stored price rather than deriving one from `chosenBreakIndex`.
 * Picking a quantity break REWRITES `unitPriceCents` at pick time, so the stored
 * value is always the chosen one and `chosenBreakIndex` is provenance, not an
 * input. Deriving here instead would give two answers whenever the two drifted.
 *
 * ⚠️ The number can carry up to `RATE_DECIMALS` fractional minor units - `1.594`
 * is $0.01594. Do not assume it is an integer.
 *
 * `null` when the line carries no price, which is a legitimate state on a quote
 * that prints "POA" against a line.
 */
export function effectiveUnitPriceCents(line: IntakeLine): number | null {
  return line.unitPriceCents
}

/** Lines that will become purchase order lines — folds and drops excluded. */
export function orderableLines(lines: IntakeLine[]): IntakeLine[] {
  return lines.filter((line) => line.foldedInto === null)
}

/**
 * Lines blocking the commit: orderable, but with no part.
 *
 * The review screen disables its commit button on a non-empty result and names
 * the count, rather than letting the create path reject the write after the
 * transcription work is already spent.
 */
export function unresolvedLines(lines: IntakeLine[]): IntakeLine[] {
  return orderableLines(lines).filter((line) => line.partRecordId === null)
}

/**
 * Sum of the orderable lines, in WHOLE minor units. The line-sum half of §3.1.
 *
 * Each line's extended amount is rounded to whole minor units before it is added,
 * because that is what the vendor's printed total is: money, to the cent. The
 * per-line price may be fractional (see {@link effectiveUnitPriceCents}), so
 * rounding the sum instead of each line would drift from the paper by a few cents
 * on a long quote and turn §3.1's honest comparison into noise.
 */
export function lineSumCents(lines: IntakeLine[]): number {
  return orderableLines(lines).reduce((sum, line) => {
    const price = effectiveUnitPriceCents(line)
    return price === null ? sum : sum + Math.round(price * line.quantity)
  }, 0)
}
