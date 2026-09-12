// packages/lib/src/field-hooks/pre/return-line-over-return-guard.ts

import { database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { getAmbientWriteDb } from '../../resources/crud/write-session-als'
import { unwrapRelationId } from '../../resources/events/captured-values'
import { checkReturnLineAgainstSoldLine } from '../../resources/hooks/return-hooks'
import type { FieldPreHookHandler } from '../types'

/** The two `return_line` fields either of which can breach the ceiling. */
export const OVER_RETURN_GUARDED_ATTRS = ['return_line_quantity', 'return_line_line_item'] as const

/**
 * The over-return ceiling on the chain that actually runs for interactive writes
 * (plans/money/tasks/54-returns.md section 3.5): Σ `quantity` across every `return_line`
 * pointing at one sold line, across ALL returns, must not exceed what that line shipped.
 *
 * 🛑 **The system-hook twin in `resources/hooks/return-hooks.ts` is coverage; this is the
 * enforcement point.** `runPreHooks` fires only for writes through `UnifiedCrudHandler` -
 * `record.create` / `record.update`, the bulk record writes, the CSV importer and the SDK. The
 * drawer, the grid's inline edit and the LineBuilder all write through `fieldValue.set ->
 * FieldValueService -> fireFieldPreHooks`, which never reads the system registry
 * (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md section 1). Of the four
 * `return` hooks this is the one that silently restocks parts for a unit that never shipped if
 * it is inert, because the salvage tree happily tears down whatever the return line claims.
 *
 * ⚠️ **Registered under BOTH attributes.** `fireFieldPreHooks` dispatches on the ONE attribute
 * being written, and either field changing can breach the ceiling: raising the quantity, or
 * re-pointing the row at a different sold line. A write that touches both simply runs this
 * twice - it is a read-only check and the second pass reaches the same verdict.
 *
 * ⚠️ **Relationship values are coerced on this chain too**, the same trap the status guards
 * carry: `validateAndConvertValue` turns a RELATIONSHIP write into
 * `{ type: 'relationship', recordId: 'defId:instId' }`, never the bare id. `unwrapRelationId`
 * (`resources/events/captured-values.ts`) takes the envelope, the array wrapper, a full
 * RecordId and a bare instance id and answers with the instance id in every case.
 *
 * 🔑 **The ambient write db is passed down deliberately.** `returns/reads.ts` types its chain
 * as `ReturnsReadDb = Database | Transaction` precisely so this works: inside a transaction
 * the ceiling and the claims must be read on the open transaction, or two return lines written
 * together are each measured against a ceiling the other has not yet consumed and the pair
 * breaches it while each passes alone.
 *
 * ✅ **Nothing is bypassed today.** `createReturnLine` / `updateReturnLine`
 * (`returns/writes.ts`) run the same check themselves before writing, so they reach the same
 * verdict rather than needing an exemption from it, and the duplicate check is a cache-warm
 * read with no side effects. There is no writer of these two fields that legitimately produces
 * a value this guard would refuse. 🛑 If one is ever written it needs
 * `bypassFieldGuards: ['return_line_quantity']` / `['return_line_line_item']`, not a weaker
 * guard.
 *
 * A row with no `line_item` is bounded by nothing: the ceiling is defined per sold line, and a
 * manually keyed return with no order has none.
 */
export const guardReturnLineOverReturn: FieldPreHookHandler = async (event) => {
  const fields = await getOrgCache()
    .from(event.organizationId, 'customFields')
    .bySystemAttributes([...OVER_RETURN_GUARDED_ATTRS])
  const quantityField = fields.return_line_quantity
  const lineItemField = fields.return_line_line_item
  if (!quantityField || !lineItemField) return event.newValue

  const writingQuantity = event.systemAttribute === 'return_line_quantity'
  let quantity = writingQuantity ? readNumber(event.newValue) : null
  let lineItemInstanceId = writingQuantity ? null : (unwrapRelationId(event.newValue) ?? null)

  // The other half of the pair: from this same request when the caller sent both
  // (the bulk path), otherwise off the stored row. `allValues` is keyed by field id.
  const otherFieldId = writingQuantity ? lineItemField.id : quantityField.id
  const alsoWritten = event.allValues.get(otherFieldId)
  if (alsoWritten !== undefined) {
    if (writingQuantity) lineItemInstanceId = unwrapRelationId(alsoWritten) ?? null
    else quantity = readNumber(alsoWritten)
  } else {
    const stored = await readStoredReturnLine(event.organizationId, event.userId, {
      recordId: event.recordId,
      quantityFieldId: quantityField.id,
      lineItemFieldId: lineItemField.id,
    })
    if (writingQuantity) lineItemInstanceId = stored.lineItemInstanceId
    else quantity = stored.quantity
  }

  if (quantity === null || lineItemInstanceId === null) return event.newValue

  const verdict = await checkReturnLineAgainstSoldLine(getAmbientWriteDb() ?? database, {
    organizationId: event.organizationId,
    lineItemInstanceId,
    // 🛑 Load-bearing on a CREATE as much as on an edit. The row's own claim is
    // already stored by the time the second of the two fields is written, so without
    // the exclusion a create of quantity 2 against a ceiling of 2 refuses itself.
    returnLineInstanceId: parseRecordId(event.recordId).entityInstanceId,
    quantity,
  })
  if (verdict.isErr()) throw verdict.error

  return event.newValue
}

/** The stored `quantity` and `lineItem` of the return line being written. */
async function readStoredReturnLine(
  organizationId: string,
  userId: string | undefined,
  target: { recordId: RecordId; quantityFieldId: string; lineItemFieldId: string }
): Promise<{ quantity: number | null; lineItemInstanceId: string | null }> {
  const stored = await new FieldValueService(organizationId, userId).getValues({
    recordId: target.recordId,
    fieldIds: [target.quantityFieldId, target.lineItemFieldId],
  })

  const quantityValue = firstValue(stored.get(target.quantityFieldId))
  const lineItemValue = firstValue(stored.get(target.lineItemFieldId))

  return {
    quantity: quantityValue?.type === 'number' ? quantityValue.value : null,
    lineItemInstanceId:
      lineItemValue?.type === 'relationship'
        ? (unwrapRelationId(lineItemValue.recordId) ?? null)
        : null,
  }
}

/** `getValues` hands back a scalar or an array depending on the field. */
function firstValue(entry: TypedFieldValue | TypedFieldValue[] | undefined) {
  return Array.isArray(entry) ? entry[0] : entry
}

/**
 * A write-time number, from the coerced `{ type: 'number', value }` envelope, a bare
 * number, or the numeric string some callers still send.
 */
function readNumber(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value && typeof value === 'object' && 'value' in value) {
    return readNumber((value as { value: unknown }).value)
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
