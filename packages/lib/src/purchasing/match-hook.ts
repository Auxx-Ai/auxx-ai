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
import { UnifiedCrudHandler } from '../resources/crud'
import { DEFAULT_MATCH_TOLERANCE, describeMatchReasons, matchBill, matchVariance } from './match'
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
 */
const MATCHABLE_STATUSES = new Set(['draft', 'matched', 'exception'])

/** Unwrap a `getFieldValues()` entry — single-value fields can still come back as arrays. */
function firstTyped(
  entry: TypedFieldValue | TypedFieldValue[] | undefined
): TypedFieldValue | undefined {
  if (!entry) return undefined
  return Array.isArray(entry) ? entry[0] : entry
}

function readNumber(
  values: Map<string, TypedFieldValue | TypedFieldValue[]>,
  fieldId: string | undefined
): number | null {
  if (!fieldId) return null
  const typed = firstTyped(values.get(fieldId))
  return typed ? (extractValue(typed) as number) : null
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

function readRelatedInstanceId(
  values: Map<string, TypedFieldValue | TypedFieldValue[]>,
  fieldId: string | undefined
): string | null {
  if (!fieldId) return null
  const typed = firstTyped(values.get(fieldId))
  if (typed?.type !== 'relationship' || !typed.recordId) return null
  return parseRecordId(typed.recordId).entityInstanceId
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
] as const

/**
 * Re-run the three-way match for one bill and write its verdict.
 *
 * Only lines carrying a `purchase_order_line` participate: a bill with no PO is legal
 * (a freight invoice, a one-off — 01 §5.1) and there is nothing to hold such a line
 * against. When NO line is matchable the bill has no verdict at all, so the two computed
 * fields are cleared rather than left showing a stale one, and a bill previously called
 * `matched` or `exception` drops back to `draft`.
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

  const matchLines: MatchLine[] = []
  let unmatchableLines = 0

  for (const lineInstanceId of lineInstanceIds) {
    const lineValues = await handler.getFieldValues(
      toRecordId('vendor_bill_line', lineInstanceId),
      billLineFieldIds
    )
    const purchaseOrderLineId = readRelatedInstanceId(
      lineValues,
      cf.vendor_bill_line_purchase_order_line?.id
    )
    if (!purchaseOrderLineId) {
      unmatchableLines += 1
      continue
    }

    const poLineValues = await handler.getFieldValues(
      toRecordId('purchase_order_line', purchaseOrderLineId),
      poLineFieldIds
    )

    matchLines.push({
      quantityBilled: readNumber(lineValues, cf.vendor_bill_line_quantity_billed?.id) ?? 0,
      // Nothing received yet reads as 0, which over-bills every billed unit — correct:
      // that IS "paying for what never arrived".
      quantityReceived: readNumber(poLineValues, cf.purchase_order_line_quantity_received?.id) ?? 0,
      unitPriceBilled: readNumber(lineValues, cf.vendor_bill_line_unit_price?.id) ?? 0,
      unitPriceExpected:
        readNumber(poLineValues, cf.purchase_order_line_expected_unit_price?.id) ?? 0,
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
        ...(currentStatus === 'matched' || currentStatus === 'exception'
          ? [{ fieldId: statusField.id, value: 'draft' }]
          : []),
      ],
    })
    return
  }

  const result = matchBill(matchLines, DEFAULT_MATCH_TOLERANCE)
  const variance = matchVariance(matchLines)

  const noteParts: string[] = []
  if (result.outcome === 'exception')
    noteParts.push(describeMatchReasons(result.reasons, currencyCode))
  if (unmatchableLines > 0) {
    noteParts.push(
      `${unmatchableLines} line${unmatchableLines === 1 ? '' : 's'} not matched to a purchase order line`
    )
  }

  await fieldValueService.setValuesForEntity({
    recordId: billRecordId,
    values: [
      { fieldId: statusField.id, value: result.outcome === 'matched' ? 'matched' : 'exception' },
      { fieldId: varianceField.id, value: variance },
      { fieldId: notesField.id, value: noteParts.length > 0 ? noteParts.join('; ') : null },
    ],
  })

  logger.info('Vendor bill matched', {
    vendorBillInstanceId,
    outcome: result.outcome,
    matchedLines: matchLines.length,
    unmatchableLines,
    variance,
  })
}

/** Re-run the match when the bill's own PO link changes (§6.2). */
export const rematchOnBillChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !BILL_MATCH_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId } = parseRecordId(event.recordId)
  await rematchBill({
    organizationId: event.organizationId,
    userId: event.userId,
    vendorBillInstanceId: entityInstanceId,
  })
}

/** Re-run the parent bill's match when one of its lines changes (§6.2). */
export const rematchOnBillLineChange: EntityFieldChangeHandler = async (event) => {
  const attr = event.field.systemAttribute as SystemAttribute | undefined
  if (!attr || !BILL_LINE_MATCH_TRIGGER_ATTRS.has(attr)) return

  const { entityInstanceId: lineInstanceId } = parseRecordId(event.recordId)
  const vendorBillInstanceId = await resolveBillForLine(
    event.organizationId,
    event.userId,
    lineInstanceId
  )
  if (!vendorBillInstanceId) return

  await rematchBill({
    organizationId: event.organizationId,
    userId: event.userId,
    vendorBillInstanceId,
  })
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

  await rematchBill({
    organizationId: event.organizationId,
    userId: event.userId,
    vendorBillInstanceId,
  })
}

/** Resolve the bill a line belongs to. Null when the line is orphaned. */
async function resolveBillForLine(
  organizationId: string,
  userId: string,
  lineInstanceId: string
): Promise<string | null> {
  const cf = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['vendor_bill_line_vendor_bill'] as const)
  const relField = cf.vendor_bill_line_vendor_bill
  if (!relField) return null

  const handler = new UnifiedCrudHandler(organizationId, userId)
  const values = await handler.getFieldValues(toRecordId('vendor_bill_line', lineInstanceId), [
    relField.id,
  ])
  return readRelatedInstanceId(values, relField.id)
}
