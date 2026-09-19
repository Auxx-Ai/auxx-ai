// packages/lib/src/accounting/purchasing/bill-intake/assign.ts

/**
 * The line matcher (plans/money/tasks/58-vendor-bill-from-the-invoice.md §3).
 *
 * Pure, no db, no clock, test-first. The pool is one purchase order's own lines
 * (usually under twenty), which is what makes signals a catalogue-wide ladder
 * could never afford - quantity, price, position - worth scoring here. See
 * `intake/resolve.ts` for the catalogue-wide version this one does not share
 * code with: that ladder matches printed codes against every part in the org
 * and has to be strict; this one matches against a handful of order lines and
 * can afford corroboration.
 */

import { isAutoLinkTier } from '../intake/client'
import { DEFAULT_MATCH_TOLERANCE, priceAllowance } from '../match'
import type {
  AssignOptions,
  BillLineFacts,
  LineProposal,
  LineProposalCandidate,
  LineProposalHint,
  OrderLineFacts,
} from './client'

/** A code tier a (printed, order) pair may earn. Never `none` - see `assignBillLines`. */
type CodeTier = 'vendor_sku' | 'sku' | 'fuzzy'

/** How many candidates one printed line offers before the list stops helping. */
const CANDIDATE_LIMIT = 5

/** Tier weight dominates every corroboration combined - see `assignBillLines`. */
const TIER_WEIGHT: Record<CodeTier, (similarity: number) => number> = {
  vendor_sku: () => 1000,
  sku: () => 800,
  fuzzy: (similarity) => Math.round(100 * similarity),
}

const TIER_REASON: Record<CodeTier, (similarity: number) => string> = {
  vendor_sku: () => 'vendor code matches',
  sku: () => 'matches our SKU',
  fuzzy: (similarity) => `description ${Math.round(similarity * 100)}% similar`,
}

/** Corroboration weights. Their sum (61) never outranks the gap between two tiers (200+). */
const CORROBORATION_WEIGHT = { quantity: 30, price: 30, position: 1 } as const

/**
 * Keywords that mark a line as a charge rather than goods, for the `hint`
 * shown on a line the matcher could not link (§3.3 rule 4). Advisory text
 * only - it decides nothing about linking.
 */
const CHARGE_KEYWORDS = [
  'freight',
  'shipping',
  'carriage',
  'surcharge',
  'tax',
  'vat',
  'handling',
  'tooling',
  'postage',
  'delivery',
  'fee',
]

/**
 * The trimmed, case-folded, punctuation-stripped form a printed code and a
 * stored code both take before they are compared.
 *
 * `null` for an empty result, which is a real state: a printed line that
 * names no vendor code folds to `null` and can never accidentally equal
 * another `null` because every comparison in `assignBillLines` checks both
 * sides are non-null first.
 *
 * This is a SEPARATE function from `intake/resolve.ts`'s private `foldKey`,
 * not a shared one - `resolve.ts`'s only trims and lowercases through
 * `normalizeForLookup`, because it is comparing values already constrained to
 * one `FieldType.TEXT` field's write-path formatting. This one also strips
 * everything but `[a-z0-9]`, because a printed vendor code varies in
 * punctuation the catalogue's own code does not ("AF-4420" vs "AF4420"), and
 * this pool is small enough (under twenty lines) that the extra folding costs
 * nothing in false positives it would cost on a catalogue-wide ladder. The two
 * MUST agree on every input `resolve.ts`'s already treats as equal - trim and
 * case are folded here too - this one only ever folds MORE inputs together,
 * never fewer.
 */
export function foldKey(value: string | null | undefined): string | null {
  if (!value) return null
  const folded = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return folded.length > 0 ? folded : null
}

/**
 * A description split into tokens for `diceSimilarity`.
 *
 * Lower-cased, then split on runs of non-alphanumeric characters (so
 * `"1/4"` becomes `["1", "4"]`), and each resulting word is further split at
 * letter-run / digit-run boundaries (so `"M8X40"` becomes `["m8", "x40"]`,
 * matching how a person reads it as two size codes run together with no
 * space). A word with no digits, or a bare digit run like `"40"`, is not
 * split further - it is already one token.
 *
 * Numeric-bearing tokens (anything containing a digit, like `"m8"` or `"40"`)
 * are the size codes and part numbers that actually distinguish one line from
 * another; `diceSimilarity` weights them accordingly.
 */
export function descriptionTokens(value: string | null | undefined): string[] {
  if (!value) return []
  const words = value.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const tokens: string[] = []
  for (const word of words) {
    const chunks = word.match(/[a-z]+[0-9]*|[0-9]+/g)
    if (chunks) tokens.push(...chunks)
  }
  return tokens
}

function isNumericBearing(token: string): boolean {
  return /[0-9]/.test(token)
}

function toWeightedMultiset(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/**
 * Weighted Dice coefficient over folded description tokens, `0..1`.
 *
 * A numeric-bearing token (a size code like `"m8"`, a bare number like
 * `"40"`) counts double on both sides of the ratio: two invoices calling the
 * same part "Hex Bolt" agree on nothing distinctive, but two calling it
 * "M8 x 40" agree on the one thing that actually identifies it. Generic
 * words still count, they are just outweighed by any size code that matches.
 *
 * `0` when either side has no tokens at all, never `NaN` - an empty
 * description is not "identical" to another empty one for this purpose, it is
 * simply nothing to compare.
 */
export function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0

  const setA = toWeightedMultiset(a)
  const setB = toWeightedMultiset(b)

  let sizeA = 0
  for (const [token, count] of setA) sizeA += count * (isNumericBearing(token) ? 2 : 1)
  let sizeB = 0
  for (const [token, count] of setB) sizeB += count * (isNumericBearing(token) ? 2 : 1)

  let intersection = 0
  for (const [token, countA] of setA) {
    const countB = setB.get(token)
    if (!countB) continue
    intersection += Math.min(countA, countB) * (isNumericBearing(token) ? 2 : 1)
  }

  if (sizeA + sizeB === 0) return 0
  return (2 * intersection) / (sizeA + sizeB)
}

/** Rank of every order line by ascending `sortOrder`, nulls last, ties by array position. */
function rankBySortOrder(
  order: OrderLineFacts[]
): Map<OrderLineFacts['orderLineRecordId'], number> {
  const indexed = order.map((line, index) => ({ line, index }))
  indexed.sort((left, right) => {
    const leftKey = left.line.sortOrder ?? Number.POSITIVE_INFINITY
    const rightKey = right.line.sortOrder ?? Number.POSITIVE_INFINITY
    if (leftKey !== rightKey) return leftKey - rightKey
    return left.index - right.index
  })
  const rank = new Map<OrderLineFacts['orderLineRecordId'], number>()
  indexed.forEach(({ line }, rankIndex) => rank.set(line.orderLineRecordId, rankIndex))
  return rank
}

/** `'charge'` when the folded description names a freight/tax/handling style charge. */
function hintFor(description: string | null): LineProposalHint {
  const folded = foldKey(description)
  if (!folded) return 'goods'
  return CHARGE_KEYWORDS.some((keyword) => folded.includes(keyword)) ? 'charge' : 'goods'
}

/** Precomputed, folded facts about one order line, so a 20-line order costs one pass, not N. */
interface FoldedOrderLine {
  vendorSkuFold: string | null
  partSkuFold: string | null
  descriptionTokens: string[]
  titleTokens: string[]
}

function foldOrderLine(line: OrderLineFacts): FoldedOrderLine {
  return {
    vendorSkuFold: foldKey(line.vendorSku),
    partSkuFold: foldKey(line.partSku),
    descriptionTokens: descriptionTokens(line.description),
    titleTokens: descriptionTokens(line.partTitle),
  }
}

/**
 * The tier a (printed, order) pair earns, if any - an if/else-if chain, so a
 * pair earns at most ONE tier, the strongest one it qualifies for (§3.2).
 */
function tierFor(
  printedVendorFold: string | null,
  printedCustomerFold: string | null,
  printedTokens: string[],
  order: FoldedOrderLine,
  threshold: number
): { tier: CodeTier; similarity: number } | null {
  if (printedVendorFold && printedVendorFold === order.vendorSkuFold) {
    return { tier: 'vendor_sku', similarity: 0 }
  }
  if (
    (printedCustomerFold && printedCustomerFold === order.partSkuFold) ||
    (printedVendorFold && printedVendorFold === order.partSkuFold)
  ) {
    return { tier: 'sku', similarity: 0 }
  }
  const similarity = Math.max(
    diceSimilarity(printedTokens, order.descriptionTokens),
    diceSimilarity(printedTokens, order.titleTokens)
  )
  if (similarity >= threshold) return { tier: 'fuzzy', similarity }
  return null
}

/**
 * Assign every printed bill line to its best candidate order line, or none.
 *
 * Rules (§3.2, §3.3), implemented exactly:
 *
 * 1. Every (printed, order) pair earns at most one tier - the strongest of
 *    `vendor_sku`, `sku`, `fuzzy` it qualifies for, via {@link tierFor}.
 * 2. Each qualifying pair becomes a candidate, scored `tierWeight +
 *    corroborations`. **Tier weight dominates**: the gap between any two
 *    tiers (200+) is larger than every corroboration combined (61), so
 *    corroboration only reorders candidates within a tier or breaks ties.
 * 3. Candidates are sorted by score descending and capped at 5. The line's
 *    `tier` is the top candidate's tier, or `none`.
 * 4. `linkedOrderLineRecordId` is set only when {@link isAutoLinkTier} allows
 *    the top tier. `fuzzy` never links - that rule lives in
 *    `isAutoLinkTier` and this function asks it rather than restating it.
 * 5. Many-to-one is allowed and never de-duplicated: two printed lines (a
 *    backorder split) may both link to the same order line.
 * 6. A line with no candidate is `'none'`, with a `hint` derived from its own
 *    description alone - computed for every line, not only unlinked ones.
 */
export function assignBillLines(
  printed: BillLineFacts[],
  order: OrderLineFacts[],
  options: AssignOptions = {}
): LineProposal[] {
  const threshold = options.descriptionThreshold ?? 0.5
  const tolerance = options.tolerance ?? DEFAULT_MATCH_TOLERANCE

  const orderRank = rankBySortOrder(order)
  const foldedOrder = order.map(foldOrderLine)

  return printed.map((line, printedIndex) => {
    const vendorFold = foldKey(line.vendorCode)
    const customerFold = foldKey(line.customerCode)
    const printedTokens = descriptionTokens(line.description)

    const candidates: LineProposalCandidate[] = []

    order.forEach((orderLine, orderIndex) => {
      const folded = foldedOrder[orderIndex]
      if (!folded) return

      const hit = tierFor(vendorFold, customerFold, printedTokens, folded, threshold)
      if (!hit) return
      const { tier, similarity } = hit

      const reasons: string[] = [TIER_REASON[tier](similarity)]
      let score = TIER_WEIGHT[tier](similarity)

      if (line.quantity !== null) {
        if (line.quantity === orderLine.ordered) {
          reasons.push(`qty ${line.quantity} = ordered`)
          score += CORROBORATION_WEIGHT.quantity
        } else if (line.quantity === orderLine.ordered - orderLine.billed) {
          reasons.push(`qty ${line.quantity} = still unbilled`)
          score += CORROBORATION_WEIGHT.quantity
        }
      }

      if (line.unitPriceCents !== null && orderLine.expectedUnitPriceCents !== null) {
        const difference = line.unitPriceCents - orderLine.expectedUnitPriceCents
        if (difference === 0) {
          reasons.push('price matches')
          score += CORROBORATION_WEIGHT.price
        } else if (
          Math.abs(difference) <= priceAllowance(orderLine.expectedUnitPriceCents, tolerance)
        ) {
          reasons.push('price within tolerance')
          score += CORROBORATION_WEIGHT.price
        }
      }

      if (orderRank.get(orderLine.orderLineRecordId) === printedIndex) {
        reasons.push('same position')
        score += CORROBORATION_WEIGHT.position
      }

      candidates.push({
        orderLineRecordId: orderLine.orderLineRecordId,
        partRecordId: orderLine.partRecordId,
        label: orderLine.partTitle ?? orderLine.description ?? 'Untitled line',
        tier,
        reasons,
        score,
      })
    })

    candidates.sort((left, right) => right.score - left.score)
    const top = candidates.slice(0, CANDIDATE_LIMIT)
    const tier = top[0]?.tier ?? 'none'
    const bestCandidate = top[0]
    const linkedOrderLineRecordId =
      bestCandidate && isAutoLinkTier(tier) ? bestCandidate.orderLineRecordId : null

    return {
      lineId: line.lineId,
      tier,
      candidates: top,
      linkedOrderLineRecordId,
      // The matcher is pure; `proposeLandedBills` fills this from the database.
      landedBillRecordId: null,
      hint: hintFor(line.description),
    }
  })
}
