// apps/web/src/components/drawers/cards/product-summary-card.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { ProductStatus, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { useMemo } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { summarizeVariants, type VariantRow } from '../tabs/summarize-variants'

/** The product's own status. */
const PRODUCT_ATTRIBUTES = ['product_status'] as const
/** Each variant's own values. Title/SKU/image ride the list payload. */
const VARIANT_ATTRIBUTES = ['part_quantity_on_hand', 'part_sell_price', 'part_sellable'] as const

/** `ProductStatus.values` keyed by option value, for badge label + colour. */
const PRODUCT_STATUS_BY_VALUE = Object.fromEntries(ProductStatus.values.map((v) => [v.value, v]))

/**
 * Family summary for the product drawer's overview and the detail page sidebar
 * (plans/products/09-variant-ui.md §7).
 *
 * The one place the family answers "is this ready to sell?" — how many variants
 * it has, how much stock stands behind them, what they cost, and how many carry
 * a price at all. The Variants tab shows the rows; this shows the shape.
 *
 * Renders NOTHING for a family with no variants, so `TabCardSection` hides the
 * whole section — the documented contract for every card in that registry.
 *
 * Reads are the same batched ALL-DIRECT hop the Variants tab uses (§4.1),
 * for the same reason: one `FieldPath` drill ref would flip `batchGetValues`
 * off its single-query fast path and resolve every ref sequentially.
 */
export function ProductSummaryCard({ entityInstanceId, recordId }: DrawerTabProps) {
  const partDefId = useResourceProperty('part', 'id')

  const { values } = useSystemValues(recordId, PRODUCT_ATTRIBUTES, { autoFetch: true })
  const status = values.product_status as string | undefined

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'product-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'product-match',
            fieldId: 'part:product' as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [entityInstanceId]
  )

  const { recordIds, total, hasNextPage, isLoading } = useRecordList({
    entityDefinitionId: partDefId ?? '',
    filters,
    enabled: !!entityInstanceId && !!partDefId,
  })

  // 🛑 Ids, not `records`. `records` is the record-store resolution of these
  // ids and arrives a wave later; the list is served from the store cache with
  // `isLoading: false`, so a `records`-keyed gate makes the whole card (and its
  // section header) vanish on a cached reopen of a product that has variants.
  // Nothing here reads `RecordMeta` — only the id.
  const rowRecordIds = useMemo(
    () => (partDefId ? recordIds.map((id) => toRecordId(partDefId, id)) : []),
    [partDefId, recordIds]
  )

  const { valuesById, loadedById } = useSystemValuesForRecords(rowRecordIds, VARIANT_ATTRIBUTES, {
    autoFetch: true,
    enabled: rowRecordIds.length > 0,
  })

  // Until every price is fetched each variant looks unpriced, and "0 of 4 priced" is a wrong number.
  const pricesLoaded = rowRecordIds.every((id) => loadedById[id]?.part_sell_price === true)

  const rows: VariantRow[] = useMemo(
    () =>
      recordIds.map((id, index) => {
        const own = valuesById[rowRecordIds[index] as RecordId]
        const price = (own?.part_sell_price as number | null | undefined) ?? null
        return {
          id,
          quantityOnHand: (own?.part_quantity_on_hand as number | null | undefined) ?? null,
          // An unsellable part's price is not offered, so it is not a price (107 D3).
          priceCents: own?.part_sellable === true ? price : null,
        }
      }),
    [recordIds, rowRecordIds, valuesById]
  )

  const summary = useMemo(
    () => summarizeVariants(rows, { total, hasNextPage }),
    [rows, total, hasNextPage]
  )

  // Nothing to summarize → no card, and TabCardSection drops the header too.
  if (isLoading || recordIds.length === 0) return null

  const statusMeta = status ? PRODUCT_STATUS_BY_VALUE[status] : undefined
  const { priceRange } = summary

  return (
    <FieldPanel resizeId='product-summary' defaultLabelWidth={130}>
      <FieldPanelRow title='Variants'>
        <div className='flex min-h-8 flex-wrap items-center gap-2 text-sm'>
          <span className='font-medium'>
            {summary.variantCount} {pluralize(summary.variantCount, 'variant')}
          </span>
          {statusMeta && (
            <Badge variant={(statusMeta.color ?? 'gray') as Variant} size='xs'>
              {statusMeta.label}
            </Badge>
          )}
        </div>
      </FieldPanelRow>

      {/* Omitted entirely when no variant has ever been counted — a family with
          unknown stock must not read as a family holding none. */}
      {summary.totalOnHand != null && (
        <FieldPanelRow title='On hand'>
          <div className='flex min-h-8 items-center text-sm tabular-nums'>
            {summary.totalOnHand}
            <span className='ms-1.5 text-xs text-muted-foreground'>
              across {summary.measuredCount} {pluralize(summary.measuredCount, 'variant')}
            </span>
          </div>
        </FieldPanelRow>
      )}

      {priceRange && (
        <FieldPanelRow title='Price'>
          <div className='flex min-h-8 items-center text-sm tabular-nums'>
            {priceRange.min === priceRange.max
              ? formatCurrency(priceRange.min)
              : `${formatCurrency(priceRange.min)}–${formatCurrency(priceRange.max)}`}
          </div>
        </FieldPanelRow>
      )}

      {/* Withheld until prices are fetched: an unfetched price is not an absent one. */}
      {pricesLoaded && (
        <FieldPanelRow title='Priced'>
          <div className='flex min-h-8 items-center text-sm'>
            <span className={summary.pricedCount === 0 ? 'text-muted-foreground' : undefined}>
              {summary.pricedCount} of {summary.measuredCount}
            </span>
            {summary.pricedCount < summary.measuredCount && (
              <span className='ms-1.5 text-xs text-muted-foreground'>
                sellable variants have a price
              </span>
            )}
          </div>
        </FieldPanelRow>
      )}
    </FieldPanel>
  )
}
