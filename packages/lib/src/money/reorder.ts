// packages/lib/src/money/reorder.ts

import { toRecordId } from '@auxx/types/resource'
import { FieldValueService } from '../field-values/field-value-service'
import type { ReorderLinesInput } from './types'

/**
 * Batch-write `line_item_sort_order = index` for a set of line items, in the order
 * the caller supplies (drag-and-drop result — money MQ1 build spec §F.5/§G.2). One
 * `FieldValueService` write per line is fine at document scale (a handful to a few
 * dozen lines); each write publishes its own event (`publishEvents` stays on — the
 * line builder's row order updates via realtime same as any other field edit).
 */
export async function reorderLines(input: ReorderLinesInput): Promise<void> {
  const { organizationId, userId, orderedLineInstanceIds } = input
  const fieldValueService = new FieldValueService(organizationId, userId)

  await Promise.all(
    orderedLineInstanceIds.map((lineInstanceId, index) =>
      fieldValueService.setValuesForEntity({
        recordId: toRecordId('line_item', lineInstanceId),
        values: [{ fieldId: 'line_item_sort_order', value: index }],
      })
    )
  )
}
