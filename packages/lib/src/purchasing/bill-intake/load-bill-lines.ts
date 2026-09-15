// packages/lib/src/purchasing/bill-intake/load-bill-lines.ts

/**
 * What the matcher is fed from a STORED bill (§3.5): the bill's header and its
 * lines, read straight off `FieldValue` the way `expense-bill/reads.ts` reads
 * a bill for posting. This is the "Match lines" door - the page's action on a
 * bill that was entered by hand or whose intake run has long since expired.
 *
 * Reads only, no actor. The router asserts view access on `vendor_bill` and
 * calls in.
 */

import { type Database, schema } from '@auxx/database'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../../cache'
import { NotFoundError } from '../../errors'
import type { BillLineFacts } from './client'
import { guard } from './guard'

/** Every `vendor_bill` header attribute this loader reads. */
const BILL_ATTRIBUTES = [
  'vendor_bill_vendor',
  'vendor_bill_purchase_order',
  'vendor_bill_currency',
  'vendor_bill_lines',
] as const

/**
 * Every `vendor_bill_line` attribute this loader reads.
 *
 * 🛑 `vendor_bill_line_vendor_code` does not exist in every org yet - entity
 * migration 159 (plans/money/tasks/58 §7.1) adds it. `bySystemAttributes`
 * answers `null` for an attribute string it does not recognise rather than
 * throwing (`cache/providers/custom-fields-provider.ts`), so a line's vendor
 * code simply reads as `null` on an org that has not migrated yet. Nothing
 * here special-cases it beyond that.
 */
const LINE_ATTRIBUTES = [
  'vendor_bill_line_vendor_code',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_sort_order',
] as const

type BillAttribute = (typeof BILL_ATTRIBUTES)[number]
type LineAttribute = (typeof LINE_ATTRIBUTES)[number]

type FieldMap<A extends string> = Record<A, { id: string } | null>

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> row`. One row per (instance, field) is all this
 * module ever expects - none of the fields read here are has_many, except
 * `vendor_bill_lines`, which is bucketed the same way and read with
 * `.values()` for its several rows.
 */
async function selectCells(
  db: Database,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, ValueRow[]>> {
  const buckets = new Map<string, ValueRow[]>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )

  for (const row of rows) {
    const list = buckets.get(row.entityId)
    if (list) list.push(row)
    else buckets.set(row.entityId, [row])
  }
  return buckets
}

/** The ids of every non-archived instance among `ids`, in the order given. */
async function liveInstanceIds(
  db: Database,
  organizationId: string,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...ids]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const live = new Set(rows.map((row) => row.id))
  return ids.filter((id) => live.has(id))
}

/** One bill line, as the matcher sees it, plus the identity the write needs. */
export interface StoredBillLineFacts extends BillLineFacts {
  lineRecordId: RecordId
  purchaseOrderLineRecordId: RecordId | null
}

/** One stored bill's header and lines, ready for `assignBillLines`. */
export interface BillLineFactsLoad {
  vendorBillInstanceId: string
  vendorRecordId: RecordId | null
  purchaseOrderRecordId: RecordId | null
  currency: string
  lines: StoredBillLineFacts[]
}

/**
 * Read one bill and its lines, straight off `FieldValue`.
 *
 * `customerCode` is always `null` here: a stored line carries no "buyer's own
 * part number" field, only the vendor's own printed code (§7.1) - the buyer
 * code exists only on the transcription at read time (§3.5).
 */
export async function loadBillLineFacts(
  db: Database,
  organizationId: string,
  vendorBillRecordId: RecordId
): Promise<Result<BillLineFactsLoad, Error>> {
  return guard(
    async () => {
      const vendorBillInstanceId = parseRecordId(vendorBillRecordId).entityInstanceId

      const [instance] = await db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, vendorBillInstanceId),
            eq(schema.EntityInstance.organizationId, organizationId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)
      if (!instance) throw new NotFoundError('Vendor bill not found', { vendorBillRecordId })

      const billFields = (await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...BILL_ATTRIBUTES] as const)) as FieldMap<BillAttribute>

      const billFieldIds = BILL_ATTRIBUTES.map((attribute) => billFields[attribute]?.id).filter(
        (id): id is string => Boolean(id)
      )
      const billCells = await selectCells(db, organizationId, [vendorBillInstanceId], billFieldIds)
      const billRows = billCells.get(vendorBillInstanceId) ?? []

      const billCell = (attribute: BillAttribute): ValueRow | undefined => {
        const fieldId = billFields[attribute]?.id
        return fieldId ? billRows.find((row) => row.fieldId === fieldId) : undefined
      }

      const [companyDefId, purchaseOrderDefId, vendorBillLineDefId, purchaseOrderLineDefId] =
        await Promise.all([
          getCachedEntityDefId(organizationId, 'company'),
          getCachedEntityDefId(organizationId, 'purchase_order'),
          getCachedEntityDefId(organizationId, 'vendor_bill_line'),
          getCachedEntityDefId(organizationId, 'purchase_order_line'),
        ])

      const vendorInstanceId = billCell('vendor_bill_vendor')?.relatedEntityId ?? null
      const purchaseOrderInstanceId =
        billCell('vendor_bill_purchase_order')?.relatedEntityId ?? null
      const currency = billCell('vendor_bill_currency')?.valueText ?? null

      const linesFieldId = billFields.vendor_bill_lines?.id
      const relatedLineIds = linesFieldId
        ? billRows
            .filter((row) => row.fieldId === linesFieldId)
            .map((row) => row.relatedEntityId)
            .filter((id): id is string => Boolean(id))
        : []
      const lineInstanceIds = await liveInstanceIds(db, organizationId, relatedLineIds)

      const lineFields = (await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([...LINE_ATTRIBUTES] as const)) as FieldMap<LineAttribute>

      const lineFieldIds = LINE_ATTRIBUTES.map((attribute) => lineFields[attribute]?.id).filter(
        (id): id is string => Boolean(id)
      )
      const lineCells = await selectCells(db, organizationId, lineInstanceIds, lineFieldIds)

      const lineCell = (lineId: string, attribute: LineAttribute): ValueRow | undefined => {
        const fieldId = lineFields[attribute]?.id
        if (!fieldId) return undefined
        return lineCells.get(lineId)?.find((row) => row.fieldId === fieldId)
      }

      const ranked = lineInstanceIds.map((instanceId) => {
        const purchaseOrderLineInstanceId = lineCell(
          instanceId,
          'vendor_bill_line_purchase_order_line'
        )?.relatedEntityId
        // Per §3.5: `lineId` is the line's RecordId string on the stored door,
        // where it doubles as `lineRecordId` - unlike the transcription door,
        // where `lineId` is only the array index (`propose.ts`).
        const lineRecordId = toRecordId(vendorBillLineDefId ?? 'vendor_bill_line', instanceId)

        const fact: StoredBillLineFacts = {
          lineId: lineRecordId,
          lineRecordId,
          purchaseOrderLineRecordId: purchaseOrderLineInstanceId
            ? toRecordId(
                purchaseOrderLineDefId ?? 'purchase_order_line',
                purchaseOrderLineInstanceId
              )
            : null,
          vendorCode: lineCell(instanceId, 'vendor_bill_line_vendor_code')?.valueText ?? null,
          customerCode: null,
          description: lineCell(instanceId, 'vendor_bill_line_description')?.valueText ?? null,
          quantity: lineCell(instanceId, 'vendor_bill_line_quantity_billed')?.valueNumber ?? null,
          unitPriceCents: lineCell(instanceId, 'vendor_bill_line_unit_price')?.valueNumber ?? null,
        }
        const sortKey = lineCell(instanceId, 'vendor_bill_line_sort_order')?.valueNumber ?? 0
        return { fact, sortKey }
      })

      const lines = ranked.sort((a, b) => a.sortKey - b.sortKey).map(({ fact }) => fact)

      return {
        vendorBillInstanceId,
        vendorRecordId: vendorInstanceId
          ? toRecordId(companyDefId ?? 'company', vendorInstanceId)
          : null,
        purchaseOrderRecordId: purchaseOrderInstanceId
          ? toRecordId(purchaseOrderDefId ?? 'purchase_order', purchaseOrderInstanceId)
          : null,
        currency: currency ?? '',
        lines,
      }
    },
    'Failed to load vendor bill line facts',
    { organizationId, vendorBillRecordId }
  )
}
