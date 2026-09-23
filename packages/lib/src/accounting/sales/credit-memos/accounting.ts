// packages/lib/src/accounting/sales/credit-memos/accounting.ts

/**
 * The credit memo's ledger half: post one memo's issue entry, and reverse it.
 *
 * ```
 *   Dr revenue_returns_allowances   the shipped goods lines' subtotal
 *   Dr revenue_shipping             the shipped shipping lines' subtotal
 *   Dr sales_tax_payable            the shipped lines' tax
 *       Cr accounts_receivable        the three together
 * ```
 *
 * Subject the memo, counterparty its contact, `storeId` the order's own source
 * account (TARGET §5). The lines come from `buildCreditMemoEntry`, which
 * `writes.ts` calls through `resolveIssue`; this file owns only the links and
 * the two primitives.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { getOrganizationSetting } from '../../../settings/settings-service'
import { documentEntryKey } from '../../documents/document-entry-key'
import type { DocumentPosting } from '../../documents/document-ledger-state'
import {
  type BuiltCreditMemoEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_SOURCE_TYPE,
  type CreditMemoEntryLine,
  computeCreditMemoAmounts,
} from '../../ledger/builders/credit-memo'
import { toAmountMinor } from '../../ledger/builders/fulfillment'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { LEDGER_CURRENCY, postEntry } from '../../ledger/post/post-entry'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { findLiveSubjectPosting, listPostingsForSource } from '../../ledger/reads/list-postings'
import type { BuiltEntry, GlPostingSourceInput, PostResult } from '../../ledger/types'
import { readOrderSourceScope } from '../../money/customer-money/reads'
import { prorateByWeight } from '../../reports/receivable-attribution'
import { roundCents } from '../totals/totals'
import type { CreditMemoLineRecord, CreditMemoRecord, ShippedMemoLines } from './reads'

/** The org's document currency, or the ledger's when the setting is blank. */
export async function organizationCurrency(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({ organizationId, key: 'organization.currency' })
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : LEDGER_CURRENCY
}

export interface CreditMemoEntrySource {
  memo: CreditMemoRecord
  lines: readonly CreditMemoLineRecord[]
  /** `YYYY-MM-DD`. The accounting date the entry is dated, resolved by the door. */
  issuedAt: string
  /** The org's document currency; refused when it differs from the ledger's. */
  currency: string
  /** The memo lines whose goods had shipped before the memo (`readShippedMemoLineIds`). */
  shippedLineIds: ShippedMemoLines
  /** How many times this memo has posted. 1 (the default) keys on the memo number. */
  generation?: number
}

/**
 * The entry this memo's CURRENT lines produce - pure, persists nothing. `null` when
 * no line had shipped: there is nothing to reverse (91 D4). The one place the record
 * shape meets the builder, so Issue, the preview and the edit lane cannot disagree.
 */
export function buildEntryForCreditMemo(
  source: CreditMemoEntrySource
): BuiltCreditMemoEntry | null {
  const { memo, lines, issuedAt, currency, shippedLineIds } = source
  const entryLines = expandCreditMemoLines({ memo, lines, shippedLineIds })
  const subtotal = roundCents(lines.reduce((sum, line) => sum + line.subtotalMinor, 0))
  const taxTotal = roundCents(lines.reduce((sum, line) => sum + (line.taxTotalMinor ?? 0), 0))
  const amounts = computeCreditMemoAmounts({
    creditMemoId: memo.id,
    number: memo.number,
    lines: entryLines,
    total: subtotal + taxTotal,
  })
  if (amounts.totalMinor === 0) return null
  return buildCreditMemoEntry({
    creditMemoId: memo.id,
    number: memo.number,
    periodKey: documentEntryKey(memo.number, source.generation ?? 1),
    issuedAt,
    currency,
    ledgerCurrency: LEDGER_CURRENCY,
    lines: entryLines,
    total: subtotal + taxTotal,
    contactInstanceId: memo.contactInstanceId,
    memo: `Credit memo ${memo.number} issued`,
  })
}

/** Split `gross` into net and tax in the ratio `net : tax`, summing exactly. */
function splitGross(
  gross: number,
  net: number,
  tax: number
): { subtotal: number; taxTotal: number } {
  const [subtotal = 0, taxTotal = 0] =
    net + tax > 0 ? prorateByWeight(gross, [Math.max(0, net), Math.max(0, tax)]) : [gross, 0]
  return { subtotal, taxTotal }
}

/**
 * The memo's lines as the entry posts them (101 E10). Pure; no line record is rewritten.
 *
 * On a `channel` memo an item-less line (the connector's refund adjustment) is not a return of
 * its own: a positive one is spread over the order's parts pro rata to net + tax, each share
 * split net/tax by its part's ratio and following that part's shipped verdict; a negative one
 * is netted against the memo's own item lines the same way. A native memo passes through.
 *
 * @throws {UnprocessableEntityError} when a positive adjustment has no order lines to spread over,
 *   or a negative one exceeds the item lines it nets against.
 */
export function expandCreditMemoLines(input: {
  memo: Pick<CreditMemoRecord, 'id' | 'number' | 'source'>
  lines: readonly CreditMemoLineRecord[]
  shippedLineIds: ShippedMemoLines
}): CreditMemoEntryLine[] {
  const { memo, shippedLineIds } = input
  // As stored: the builder validates the amounts, so a line nothing touches passes through.
  const asStored = input.lines.map(
    (line): CreditMemoEntryLine => ({
      subtotal: line.subtotalMinor,
      taxTotal: line.taxTotalMinor,
      shipped: shippedLineIds.has(line.id),
      component: line.disposition === 'shipping' ? 'shipping' : 'goods',
    })
  )
  if (memo.source !== 'channel') return asStored

  const minor = input.lines.map((line, index) => {
    const label = `Credit memo ${memo.number} line ${index + 1}`
    const subtotal = toAmountMinor(line.subtotalMinor, `${label} subtotal`)
    const taxTotal = toAmountMinor(line.taxTotalMinor, `${label} tax`)
    const kind =
      line.disposition === 'shipping' ? 'shipping' : line.lineItemInstanceId ? 'item' : 'adjustment'
    return { subtotal, taxTotal, gross: subtotal + taxTotal, kind }
  })
  const isAdjustment = (i: number) => minor[i]?.kind === 'adjustment' && minor[i]?.gross !== 0
  if (!minor.some((_, i) => isAdjustment(i))) return asStored
  const context = { creditMemoId: memo.id, number: memo.number }

  // The money the merchant kept (a negative remainder) comes off the memo's own item lines.
  const kept = -minor.reduce((sum, m, i) => sum + (isAdjustment(i) ? Math.min(0, m.gross) : 0), 0)
  const itemGross = minor.map((m) => (m.kind === 'item' ? Math.max(0, m.gross) : 0))
  if (kept > itemGross.reduce((sum, g) => sum + g, 0))
    throw new UnprocessableEntityError(
      `Credit memo ${memo.number} keeps back ${kept} more than its item lines credit, so there ` +
        'is nothing left to net the refund adjustment against.',
      { ...context, keptMinor: String(kept) }
    )
  const cuts = prorateByWeight(kept, itemGross)

  const out: CreditMemoEntryLine[] = []
  const spread: CreditMemoEntryLine[] = []
  const parts = shippedLineIds.orderParts ?? []
  const weights = parts.map((part) => Math.max(0, part.netMinor) + Math.max(0, part.taxMinor))
  minor.forEach((m, i) => {
    const stored = asStored[i] as CreditMemoEntryLine
    if (!isAdjustment(i)) {
      const cut = cuts[i] ?? 0
      if (cut === 0) return out.push(stored)
      const off = splitGross(cut, m.subtotal, m.taxTotal)
      return out.push({
        ...stored,
        subtotal: m.subtotal - off.subtotal,
        taxTotal: m.taxTotal - off.taxTotal,
      })
    }
    if (m.gross < 0) return
    // A positive remainder stands for the whole order, goods and shipping both.
    if (!parts.some((part) => part.component === 'goods') || !weights.some((w) => w > 0))
      throw new UnprocessableEntityError(
        `Credit memo ${memo.number} refunds an amount with no items named, and its order has no ` +
          'line items to spread it over. It issues once the order and its lines have synced.',
        context
      )
    prorateByWeight(m.gross, weights).forEach((share, p) => {
      const part = parts[p]
      if (!part || share === 0) return
      spread.push({
        ...splitGross(share, part.netMinor, part.taxMinor),
        shipped: part.shipped,
        component: part.component,
      })
    })
  })
  return [...out, ...spread]
}

export interface PostCreditMemoEntryInput {
  organizationId: string
  /** The `credit_memo` EntityInstance id. */
  creditMemoInstanceId: string
  /** The memo's `credit_memo_contact`, for the receivable's counterparty. */
  contactInstanceId: string | null
  /** The order the memo credits, for the store axis. Null on a native memo. */
  orderInstanceId: string | null
  entry: BuiltEntry
  actorUserId?: string
  memo?: string
}

/**
 * Post one credit memo's issue entry.
 *
 * **Never throws** - `postEntry` never does, and the caller decides whether a
 * refusal refuses the issue.
 */
export async function postCreditMemoEntry(
  db: Database,
  input: PostCreditMemoEntryInput
): Promise<PostResult> {
  const { organizationId, creditMemoInstanceId, contactInstanceId, entry, actorUserId } = input

  // Task 47 §5. A memo belongs to at most one order, so one scope covers the
  // whole entry and `revenue_returns_allowances` lands in the store's own
  // contra-revenue account when the org keeps one.
  const scope = await readOrderSourceScope(db, organizationId, input.orderInstanceId)
  const sources: GlPostingSourceInput[] = [
    { sourceKind: CREDIT_MEMO_SOURCE_TYPE, sourceId: creditMemoInstanceId, linkRole: 'subject' },
    ...(contactInstanceId
      ? [{ sourceKind: 'contact', sourceId: contactInstanceId, linkRole: 'counterparty' as const }]
      : []),
  ]
  const lock = await resolvePeriodLock(organizationId)
  return postEntry(db, {
    organizationId,
    entry,
    actorUserId,
    lock,
    memo: input.memo,
    scope,
    sources,
    storeId: typeof scope.store === 'string' ? scope.store : null,
  })
}

/** Every general-ledger entry sourced on one credit memo, newest first. */
export async function listCreditMemoPostings(
  db: Database,
  params: { organizationId: string; creditMemoInstanceId: string }
): Promise<DocumentPosting[]> {
  const { organizationId, creditMemoInstanceId } = params
  const result = await listPostingsForSource(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  if (result.isErr()) return []
  return result.value.map((posting) => ({
    glPostingId: posting.id,
    docNumber: posting.docNumber,
    status: posting.status,
    postingType: posting.postingType,
  }))
}

/**
 * Reverse the memo's live issue posting, freeing the claim. `null` when nothing
 * is standing - an unposted memo voids freely.
 */
export async function reverseCreditMemoEntry(
  db: Database,
  input: {
    organizationId: string
    creditMemoInstanceId: string
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, creditMemoInstanceId, actorUserId, memo } = input
  const live = await findLiveSubjectPosting(db, {
    organizationId,
    sourceKind: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  if (live.isErr()) throw new UnprocessableEntityError(live.error.message)
  if (!live.value) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, {
    organizationId,
    glPostingId: live.value.id,
    actorUserId,
    lock,
    memo: memo ?? `Reversal of ${live.value.docNumber} - credit memo voided`,
  })
}
