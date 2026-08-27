// packages/lib/src/money/reorder.ts

import { toRecordId } from '@auxx/types/resource'
import { FieldValueService } from '../field-values/field-value-service'
import type { ReorderLinesInput } from './types'

/**
 * Batch-write `<line>_sort_order = index` for a set of lines, in the order the
 * caller supplies (drag-and-drop result — money MQ1 build spec §F.5/§G.2). One
 * `FieldValueService` write per line is fine at document scale (a handful to a few
 * dozen lines); each write publishes its own event (`publishEvents` stays on — the
 * line builder's row order updates via realtime same as any other field edit).
 *
 * ⚠️ `lineEntityType` and `sortAttribute` are ONE decision in two arguments and
 * default together. Passing a purchasing entity type while leaving the attribute
 * at the `line_item` default writes `line_item_sort_order` onto a
 * `purchase_order_line`, which resolves to no field and fails silently — the
 * rows simply keep their old order.
 */
export async function reorderLines(input: ReorderLinesInput): Promise<void> {
  const {
    organizationId,
    userId,
    orderedLineInstanceIds,
    lineEntityType = 'line_item',
    sortAttribute = `${lineEntityType}_sort_order`,
  } = input
  const fieldValueService = new FieldValueService(organizationId, userId)

  await Promise.all(
    orderedLineInstanceIds.map((lineInstanceId, index) =>
      fieldValueService.setValuesForEntity({
        recordId: toRecordId(lineEntityType, lineInstanceId),
        values: [{ fieldId: sortAttribute, value: index }],
      })
    )
  )
}
