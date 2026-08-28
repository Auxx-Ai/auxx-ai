// packages/lib/src/purchasing/match-hook.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { TypedFieldValue } from '@auxx/types'
import { extractValue } from '@auxx/types'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import type { SystemAttribute } from '@auxx/types/system-attribute'
import { getOrgCache } from '../cache'
import type { EntityFieldChangeHandler, EntityPostDeleteHandler } from '../field-hooks/types'
import { FieldValueService } from '../field-values/field-value-service'
import { readFieldRelations, readFieldScalars } from '../field-values/read-field-scalars'
import { UnifiedCrudHandler } from '../resources/crud'
import {
  DEFAULT_MATCH_TOLERANCE,
  describeAwaitingLines,
  describeMatchReasons,
  matchBill,
  matchVariance,
} from './match'
import { markOrRematchBill, markOrRematchBillLine } from './match-reconciler'
import type { MatchLine } from './types'

const logger = createScopedLogger('purchasing:match-hook')

/**
 * Where the three-way match actually runs (plans/purchasing/01-build-plan.md §6.2).
 *
 * `match.ts` is pure and knows nothing about the database — this is the one member of
 * `purchasing/` that reads and writes. It is deliberately NOT re-exported from
 * `client.ts`, which stays pure so the UI can preview a match before commit.
 *
 * The match computes per line, rolls up to the bill, and writes `vendor_bill_status`,
 * `vendor_bill_match_variance` and `vendor_bill_match_notes` — the three fields declared
 * `creatable: false` with "the three-way match hook is the only writer" in their
 * descriptions.
 */

/** Fields on `vendor-bills` whose write should re-run the match. */
export const BILL_MATCH_TRIGGER_ATTRS = new Set<SystemAttribute>([
  // Pointing a bill at a different PO changes nothing this function reads directly —
  // the match key is per LINE — but it is the moment a human declares the bill matchable,
  // and re-running then is what puts a freshly linked bill into the queue.
  'vendor_bill_purchase_order',
])

/**
 * Fields on `vendor-bill-lines` whose write should re-run the parent bill's match.
 *
 * ⚠️ `vendor_bill_status`, `_match_variance` and `_match_notes` are absent by
 * construction — they are what this hook WRITES, and a trigger set that contained them
 * would recurse.
 */
export const BILL_LINE_MATCH_TRIGGER_ATTRS = new Set<SystemAttribute>([
  'vendor_bill_line_vendor_bill',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
])

/**
 * The statuses a recomputed match may overwrite.
 *
 * `posted`, `paid` and `void` are settled facts about a document that has already left
 * this system — a late edit to a line must never silently un-post a bill the GL has an
 * entry for. Those need a human reversal, not a hook.
 *
 * 🛑 `awaiting_receipt` MUST be in this set. It is the one status the match itself writes
 * that is waiting on an event outside the bill — the goods landing — and the write that
 * resolves it comes from the receipt side via `rematchBillsForPurchaseOrderLines`. Leave it
 * out and a prepaid bill enters `awaiting_receipt` and can never leave, which is precisely
 * the never-resolving state P24 was designed around.
 */
export const MATCHABLE_STATUSES = new Set(['draft', 'awaiting_receipt', 'matched', 'exception'])

/** Statuses the match wrote itself, and may therefore reset to `draft`. */
const MATCH_WRITTEN_STATUSES = new Set(['awaiting_receipt', 'matched', 'exception'])

/** Unwrap a `getFieldValues()` entry — single-value fields can still come back as arrays. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

function readString(
  values: Map<string, TypedFieldValue | TypedFieldValue[]>,
  fieldId: string | undefined
): string | null {
  if (!fieldId) return null
  const typed = firstTyped(values.get(fieldId))
  const value = typed ? extractValue(typed) : null
  return typeof value === 'string' && value ? value : null
}

/** A number out of {@link readFieldScalars}' scalar map. */
function num(values: Map<string, unknown> | undefined, fieldId: string | undefined): number | null {
  if (!values || !fieldId) return null
  const value = values.get(fieldId)
  return typeof value === 'number' ? value : null
}

/**
 * A date out of {@link readFieldScalars}' scalar map.
 *
 * `FieldValue.valueDate` is a `timestamp(..., { mode: 'string' })` column, so the
 * scalar arrives as an ISO string and NOT as a `Date` — the driver hands back
 * exactly what the column mode says. An unparseable value degrades to `null`,
 * which the match reads as "no expected date" and leaves the line awaiting
 * rather than calling it late off a date it could not read.
 */
function date(values: Map<string, unknown> | undefined, fieldId: string | undefined): Date | null {
  if (!values || !fieldId) return null
  const value = values.get(fieldId)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const MATCH_ATTRS = [
  'vendor_bill_status',
  'vendor_bill_currency',
  'vendor_bill_match_variance',
  'vendor_bill_match_notes',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_purchase_order_line',
  'purchase_order_line_quantity_received',
  'purchase_order_line_expected_unit_price',
  // The aging leg (P24). `expectedAt` lives on the purchase order HEADER, not the
  // line, so reaching it costs one relationship hop from the PO line.
  'purchase_order_line_purchase_order',
  'purchase_order_expected_at',
] as const

/**
 * Re-run the three-way match for one bill and write its verdict.
 *
 * Only lines carrying a `purchase_order_line` participate: a bill with no PO is legal
 * (a freight invoice, a one-off — 01 §5.1) and there is nothing to hold such a line
 * against. When NO line is matchable the bill has no verdict at all, so the two computed
 * fields are cleared rather than left showing a stale one, and a bill the match itself
 * had called `matched`, `awaiting_receipt` or `exception` drops back to `draft`.
 *
 * Unmatchable lines on an otherwise matchable bill are counted into the notes but never
 * change the outcome — a freight line beside three goods lines is ordinary. What they are
 * NOT is invisible.
 *
 * Exported so the router can re-run a match on demand; the hooks below are thin filters
 * over it.
 */
export async function rematchBill(params: {
  organizationId: string
  userId: string
  vendorBillInstanceId: string
  db?: Database
}): Promise<void> {
  const { organizationId, userId, vendorBillInstanceId, db } = params
  const billRecordId = toRecordId('vendor_bill', vendorBillInstanceId)
  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes<SystemAttribute>([...MATCH_ATTRS])

  const statusField = cf.vendor_bill_status
  const varianceField = cf.vendor_bill_match_variance
  const notesField = cf.vendor_bill_match_notes
  if (!statusField || !varianceField || !notesField) {
    logger.warn('Missing vendor bill match fields — skipping match', { organizationId })
    return
  }

  // The bill's own currency, read for one reason: `describeMatchReasons` renders
  // money in major units and needs the exponent (2 for USD, 0 for JPY). It is a
  // field on the bill rather than the org default because that is what the
  // amounts on this document are denominated in.
  const currencyField = cf.vendor_bill_currency
  const billValues = await handler.getFieldValues(
    billRecordId,
    [statusField.id, currencyField?.id].filter((id): id is string => !!id)
  )
  const statusTyped = firstTyped(billValues.get(statusField.id))
  const currentStatus = statusTyped ? (extractValue(statusTyped) as string) : null
  const currencyCode = readString(billValues, currencyField?.id) ?? 'USD'
  // A bill with no status yet is a freshly created draft.
  if (currentStatus !== null && !MATCHABLE_STATUSES.has(currentStatus)) return

  const { ids: lineInstanceIds } = await handler.listFiltered({
    entityDefinitionId: 'vendor_bill_line',
    filters: [
      {
        id: 'bill-lines',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'bill-lines-parent',
            fieldId: 'vendor_bill_line:vendorBill',
            operator: 'is',
            value: billRecordId,
          },
        ],
      },
    ],
    limit: 1000,
  })

  const billLineFieldIds = [
    cf.vendor_bill_line_quantity_billed?.id,
    cf.vendor_bill_line_unit_price?.id,
    cf.vendor_bill_line_purchase_order_line?.id,
  ].filter((id): id is string => !!id)

  const poLineFieldIds = [
    cf.purchase_order_line_quantity_received?.id,
    cf.purchase_order_line_expected_unit_price?.id,
  ].filter((id): id is string => !!id)

  /**
   * Set-based reads, not reads per line.
   *
   * This loop used to issue a `getFieldValues` for the bill line AND another for
   * its purchase-order line, serially, per line — so a 10-line bill cost 20 round
   * trips per match, and the hook that calls it fires once per changed FIELD.
   * Entering that bill was ~30 matches, ~690 round trips. The same defect #1953
   * fixed in the totals engine, doubled.
   *
   * 🛑 The aging leg (P24) added a THIRD rung — PO line → purchase order →
   * `expectedAt` — and it is walked the same way: one `readFieldRelations` over
   * every PO line at once, then one `readFieldScalars` over every order at once.
   * Five queries for a bill of any size. Reading the header per line would
   * reintroduce #1953 exactly.
   */
  const poLineRelId = cf.vendor_bill_line_purchase_order_line?.id
  const [billLineValues, billLineRels] = await Promise.all([
    readFieldScalars(db, organizationId, lineInstanceIds, billLineFieldIds),
    poLineRelId
      ? readFieldRelations(db, organizationId, lineInstanceIds, [poLineRelId])
      : Promise.resolve(new Map<string, Map<string, string>>()),
  ])

  const poLineIds = lineInstanceIds
    .map((id) => (poLineRelId ? billLineRels.get(id)?.get(poLineRelId) : undefined))
    .filter((id): id is string => !!id)

  const orderRelId = cf.purchase_order_line_purchase_order?.id
  const [poLineValues, poLineOrderRels] = await Promise.all([
    readFieldScalars(db, organizationId, poLineIds, poLineFieldIds),
    orderRelId
      ? readFieldRelations(db, organizationId, poLineIds, [orderRelId])
      : Promise.resolve(new Map<string, Map<string, string>>()),
  ])

  const expectedAtFieldId = cf.purchase_order_expected_at?.id
  const orderIds = poLineIds
    .map((id) => (orderRelId ? poLineOrderRels.get(id)?.get(orderRelId) : undefined))
    .filter((id): id is string => !!id)
  const orderValues = expectedAtFieldId
    ? await readFieldScalars(db, organizationId, orderIds, [expectedAtFieldId])
    : new Map<string, Map<string, unknown>>()

  const matchLines: MatchLine[] = []
  let unlinkedLines = 0
  let untypedLines = 0

  for (const lineInstanceId of lineInstanceIds) {
    const purchaseOrderLineId = poLineRelId
      ? billLineRels.get(lineInstanceId)?.get(poLineRelId)
      : undefined
    if (!purchaseOrderLineId) {
      unlinkedLines += 1
      continue
    }

    const line = billLineValues.get(lineInstanceId)
    const poLine = poLineValues.get(purchaseOrderLineId)
    const orderId = orderRelId
      ? poLineOrderRels.get(purchaseOrderLineId)?.get(orderRelId)
      : undefined

    /**
     * 🛑 An UNTYPED price is absence, not zero — and a line carrying one is not
     * matchable at all.
     *
     * `billLineValuesFromPurchaseOrderLine` deliberately leaves `unitPrice` blank
     * when a bill is raised from a purchase order, because it is a value the match
     * COMPARES and prefilling it would make the match rubber-stamp itself. That is
     * correct. But reading the blank as `0` then makes it a genuine disagreement
     * with the order's expected price, so every freshly raised bill was an
     * `exception` on price from birth — and could never reach `awaiting_receipt`,
     * which is precisely the population P24 exists to serve.
     *
     * ⚠️ The tempting fix — skip the price arm when the price is absent — is
     * WORSE. A bill whose goods have arrived and whose prices nobody has typed
     * would then read `matched`, and `matched` is the one status that posts to the
     * GL automatically. Silently posting an invoice no human has transcribed beats
     * a false exception for damage.
     *
     * So an untyped line is treated exactly like a line with no purchase-order
     * link: unmatchable. A bill with nothing matchable falls back to `draft` and
     * its verdict is cleared, which is the honest answer — there is nothing to
     * judge yet.
     *
     * Absent, NOT zero: `num` returns `null` only when there is no numeric value
     * to read, so a vendor legitimately billing $0.00 (a free replacement) is a
     * value like any other and still matches normally.
     */
    const unitPriceBilled = num(line, cf.vendor_bill_line_unit_price?.id)
    if (unitPriceBilled === null) {
      untypedLines += 1
      continue
    }

    matchLines.push({
      quantityBilled: num(line, cf.vendor_bill_line_quantity_billed?.id) ?? 0,
      // Nothing received yet reads as 0 — and under P24 that is NOT an exception.
      // Vendors here often will not ship until the invoice is paid, so billed >
      // received is the normal state of a CORRECT bill for weeks. `matchBill`
      // calls it `awaiting_receipt` and ages it off the order's `expectedAt`
      // below; it becomes a real `receipt_overdue` exception only once late.
      quantityReceived: num(poLine, cf.purchase_order_line_quantity_received?.id) ?? 0,
      unitPriceBilled,
      unitPriceExpected: num(poLine, cf.purchase_order_line_expected_unit_price?.id) ?? 0,
      // The PO HEADER's expected date, shared by every line of one order. Null when
      // the order carries none (the field is nullable and nothing prefills it), in
      // which case the line stays awaiting indefinitely rather than becoming an
      // exception on a date nobody agreed — see `isReceiptOverdue`.
      expectedAt: orderId ? date(orderValues.get(orderId), expectedAtFieldId) : null,
    })
  }

  const fieldValueService = new FieldValueService(organizationId, userId, db)

  if (matchLines.length === 0) {
    // No verdict is possible. Clearing beats leaving a stale one on the queue.
    await fieldValueService.setValuesForEntity({
      recordId: billRecordId,
      values: [
        { fieldId: varianceField.id, value: null },
        { fieldId: notesField.id, value: null },
        ...(currentStatus && MATCH_WRITTEN_STATUSES.has(currentStatus)
          ? [{ fieldId: statusField.id, value: 'draft' }]
          : []),
      ],
    })
    return
  }

  /**
   * The one clock in the three-way match.
   *
   * `match.ts` is pure and takes `asOf` as a parameter precisely so the aging rule
   * can be tested to exhaustion; this is the impure layer, so this is where "now"
   * is read. Read ONCE and threaded into both calls, so the verdict and the
   * variance can never disagree about which side of a grace-period boundary the
   * bill sits on.
   */
  const asOf = new Date()
  const result = matchBill(matchLines, asOf, DEFAULT_MATCH_TOLERANCE)
  const variance = matchVariance(matchLines, asOf, DEFAULT_MATCH_TOLERANCE)

  const noteParts: string[] = []
  if (result.outcome === 'exception')
    noteParts.push(describeMatchReasons(result.reasons, currencyCode))
  if (result.outcome === 'awaiting_receipt') noteParts.push(describeAwaitingLines(result.awaiting))
  // Two different reasons a line sits out, reported separately: "not linked to a
  // purchase order" sends someone to fix the link, "no price entered" sends them to
  // the invoice. One merged count would send them to the wrong place.
  if (unlinkedLines > 0) {
    noteParts.push(
      `${unlinkedLines} line${unlinkedLines === 1 ? '' : 's'} not matched to a purchase order line`
    )
  }
  if (untypedLines > 0) {
    noteParts.push(
      `${untypedLines} line${untypedLines === 1 ? '' : 's'} with no unit price entered yet`
    )
  }

  /**
   * 🛑 An untyped line blocks `matched` — but never hides a real `exception`.
   *
   * `matched` is the ONE status that posts to the general ledger automatically, so
   * it has to mean "the whole document was compared and it agrees". A bill with a
   * line nobody has priced yet has not been compared — only part of it has. Left
   * alone, such a bill renders a green badge with a quiet note beside it, and the
   * poster reads the STATUS, not the note.
   *
   * `awaiting_receipt` is demoted for the same reason: it is a verdict, and the
   * honest answer on a half-transcribed bill is that there is no verdict yet.
   *
   * An `exception` is NOT demoted. A price or receipt problem on a line that HAS
   * been transcribed is a real finding, and burying it until somebody finishes
   * typing the rest of the invoice is how a control stops being run.
   *
   * ⚠️ An UNLINKED line does not do this. A freight line on a goods bill is
   * deliberately outside the match and always was — that is why the two are
   * counted separately. Untyped is an omission; unlinked is a decision.
   */
  const notFullyTranscribed = untypedLines > 0 && result.outcome !== 'exception'

  // The outcome IS the status value — `matched` / `awaiting_receipt` / `exception`
  // are all three members of `VendorBillStatus`, so no mapping table is needed and
  // a fourth outcome would fail to compile rather than silently become `exception`.
  const verdict = [
    { fieldId: statusField.id, value: notFullyTranscribed ? 'draft' : result.outcome },
    // Null rather than the partial figure: a variance computed across only the
    // lines that happen to be typed is not the bill's variance.
    { fieldId: varianceField.id, value: notFullyTranscribed ? null : variance },
    { fieldId: notesField.id, value: noteParts.length > 0 ? noteParts.join('; ') : null },
  ]

  /**
   * Skip a write that would store the verdict already on the bill.
   *
   * Most re-matches reach the same answer — the second of two attributes set in
   * one line write, a quantity edited back to what it was — and each one
   * previously re-entered the field-value layer, the realtime publisher and the
   * sync manifest to store an identical status. Conservative the same way
   * `totals-hooks.ts` is: unless EVERY value is already present and equal, the
   * write happens.
   */
  const stored = await readFieldScalars(
    db,
    organizationId,
    [vendorBillInstanceId],
    [statusField.id, varianceField.id, notesField.id]
  )
  const current = stored.get(vendorBillInstanceId)
  if (verdict.every((v) => (current?.get(v.fieldId) ?? null) === v.value)) return

  await fieldValueService.setValuesForEntity({ recordId: billRecordId, values: verdict })

  logger.info('Vendor bill matched', {
    vendorBillInstanceId,
    outcome: result.outcome,
    matchedLines: matchLines.length,
    unlinkedLines,
    untypedLines,
    variance,
  })
}

/** Re-run the match when the bill's own PO link changes (§6.2). */
export const rematchOnBillChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !BILL_MATCH_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await markOrRematchBill(event.organizationId, event.userId, entityInstanceId)
}

/** Re-run the parent bill's match when one of its lines changes (§6.2). */
export const rematchOnBillLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !BILL_LINE_MATCH_TRIGGER_ATTRS.has(attr)) return

  // The bill is resolved in the DRAIN, not here: the per-line lookup cost a round
  // trip on every one of the four trigger attributes, and the batched resolver
  // does the whole bill in one query.
  const { entityInstanceId: lineInstanceId } = parseRecordId(event.recordId)
  await markOrRematchBillLine(event.organizationId, event.userId, lineInstanceId)
}

/**
 * Re-run the match after a bill line is deleted. Deletes fire no field-change hook, so
 * without this a removed over-billed line leaves the bill sitting in the exception queue
 * for a reason that no longer exists.
 */
export const rematchAfterBillLineDelete: EntityPostDeleteHandler = async (event) => {
  const raw = event.values.vendor_bill_line_vendor_bill
  if (typeof raw !== 'string' || raw.length === 0) return
  const vendorBillInstanceId = raw.includes(':')
    ? parseRecordId(raw as RecordId).entityInstanceId
    : raw

  await markOrRematchBill(event.organizationId, event.userId, vendorBillInstanceId)
}
