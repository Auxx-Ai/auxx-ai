// packages/lib/src/returns/returnable-lines.ts

/**
 * The read behind "Add from order" (plans/money/tasks/56-return-lines-on-the-line-grid.md
 * section 4.6): every `line_item` sold on an order, with the same ceiling and
 * claim total the over-return guard itself is built from, so the sheet offers
 * exactly what a create would accept - never a looser or a stricter number
 * derived a second way.
 *
 * Reads only, same as `reads.ts` and for the same reason (`docs/lib-module-guide.md`
 * section 5). No permission checks: the router asserts.
 */

import type { Database } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import type { Result } from 'neverthrow'
import { batchGetRelatedDisplayNames } from '../field-values/field-value-helpers'
import { LINE_ITEM_FIELDS } from '../resources/registry/resources/line-item-fields'
import { pickSystemAttributes } from '../resources/registry/system-attributes'
import type { RecordId } from '../resources/resource-id'
import { toRecordId } from '../resources/resource-id'
import { readSystemRecords, systemFields } from '../resources/system-records'
import { guard } from './guard'
import { readReturnCeilings, readReturnedQuantityClaimsBatch } from './reads'

/** The `line_item` attributes the sheet reads, checked against the registry. */
const LINE_ITEM_PICK = pickSystemAttributes(LINE_ITEM_FIELDS, [
  'line_item_order',
  'line_item_name',
  'line_item_part',
  'line_item_qty',
  'line_item_sort_order',
] as const)

/** One sold line on an order, with what it may still return. */
export interface ReturnableLine {
  lineItemId: string
  recordId: RecordId
  /** The sold line's display name, or null. */
  name: string | null
  partId: string | null
  partName: string | null
  quantitySold: number | null
  /** Same semantics as `ReturnableQuantity`: null when nothing records what left. */
  ceiling: number | null
  alreadyReturned: number
  remaining: number | null
  ceilingSource: 'shipped' | 'sold' | 'unknown'
}

/**
 * Every `line_item` on one order, in the order's own line sort
 * (`line_item_sort_order` when the field is provisioned, else `createdAt`
 * ascending), each carrying the same ceiling `readReturnCeilings` computes and
 * the same claim total `readReturnedQuantityClaimsBatch` sums.
 *
 * 🛑 `ceilingSource: 'unknown'` carries `ceiling: null, remaining: null`. Never
 * zero, never blocking (plan section 4.6, the de-dup regression 54 already
 * fixed): a line with neither shipped nor sold data recorded is not the same
 * as a line that shipped nothing, and the sheet must still offer it.
 *
 * Six queries for an order of any size: three for the lines and their cells,
 * one for the part display names, one for the dispatch sums and one for the
 * existing claims. The sold quantities the ceiling falls back to are the ones
 * already read here, so no line is measured twice.
 *
 * Returns an empty list rather than refusing when the order has no line
 * items, or when the org has no `line_item.order` field or `line_item`
 * definition yet: both are "nothing to offer", not failures.
 */
export async function readReturnableLinesForOrder(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<Result<ReturnableLine[], Error>> {
  return guard(
    async () => {
      const ctx = await systemFields(db, organizationId, 'line_item', LINE_ITEM_PICK)
      if (!ctx?.fields.line_item_order) return []

      const records = await readSystemRecords(db, organizationId, ctx, {
        by: { attribute: 'line_item_order', in: [orderId] },
      })
      if (records.length === 0) return []

      // Sort by `line_item_sort_order` when the org has it; otherwise the
      // `createdAt` order the reader already produced stands. A row with no
      // sort value of its own sorts after every row that has one, so a
      // half-migrated order still reads in a sensible order rather than
      // scrambled by `undefined` comparisons.
      const ordered = ctx.fields.line_item_sort_order
        ? [...records].sort((a, b) => {
            const sortA = a.number('line_item_sort_order')
            const sortB = b.number('line_item_sort_order')
            if (sortA == null && sortB == null) return 0
            if (sortA == null) return 1
            if (sortB == null) return -1
            return sortA - sortB
          })
        : records

      const lineItemIds = ordered.map((record) => record.id)
      // A provisioned `line_item_qty` with no row is a ceiling of zero, not an
      // unknown one - the same distinction the guard has always drawn.
      const absentQuantity = ctx.fields.line_item_qty ? 0 : null
      const soldQuantities = new Map(
        ordered.map((record) => [record.id, record.number('line_item_qty') ?? absentQuantity])
      )

      const [partNames, ceilings, claims] = await Promise.all([
        batchGetRelatedDisplayNames(
          db,
          organizationId,
          ordered
            .map((record) => relatedRecordId(record.cell('line_item_part')))
            .filter((recordId): recordId is RecordId => recordId != null)
        ),
        readReturnCeilings(db, organizationId, lineItemIds, { soldQuantities }),
        readReturnedQuantityClaimsBatch(db, organizationId, lineItemIds),
      ])

      return ordered.map((record) => {
        const partId = record.related('line_item_part')
        const { ceiling, ceilingSource } = ceilings.get(record.id) ?? {
          ceiling: null,
          ceilingSource: 'unknown' as const,
        }
        const alreadyReturned = (claims.get(record.id) ?? []).reduce(
          (total, claim) => total + claim.quantity,
          0
        )

        return {
          lineItemId: record.id,
          recordId: toRecordId(ctx.defId, record.id),
          name: record.text('line_item_name'),
          partId,
          partName: partId ? (partNames.get(partId) ?? null) : null,
          quantitySold: soldQuantities.get(record.id) ?? null,
          ceiling,
          alreadyReturned,
          remaining: ceiling === null ? null : Math.max(0, ceiling - alreadyReturned),
          ceilingSource,
        }
      })
    },
    'Failed to read returnable lines for order',
    { organizationId, orderId }
  )
}

/** The `RecordId` a relationship cell already carries, for the display-name batch. */
function relatedRecordId(value: TypedFieldValue | undefined): RecordId | null {
  return value?.type === 'relationship' && value.recordId ? value.recordId : null
}
