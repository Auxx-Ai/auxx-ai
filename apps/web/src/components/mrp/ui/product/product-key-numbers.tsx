// apps/web/src/components/mrp/ui/product/product-key-numbers.tsx
'use client'

import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { EmptySection } from '@auxx/ui/components/section'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatDay, formatDays, formatQty, onOrderDescription } from '../part/key-numbers'

export type MrpProductItemData = RouterOutputs['mrp']['productItem']
export type MrpProductVariantData = MrpProductItemData['variants'][number]

/** A variant's display name by part id; an unnamed part reads "Unnamed part". */
export function variantName(data: MrpProductItemData | undefined, partId: string): string {
  return data?.variants.find((v) => v.partId === partId)?.name ?? 'Unnamed part'
}

/** "2 purchases · 1 build", or "none". */
function suggestionsLabel(s: MrpProductItemData['totals']['suggestions']): string {
  const parts = [
    s.purchase > 0 ? `${s.purchase} purchase${s.purchase === 1 ? '' : 's'}` : null,
    s.build > 0 ? `${s.build} build${s.build === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'none'
}

interface ProductKeyNumbersProps {
  productId: string
  runId: string | null
}

/** The 3 × 3 family metrics of 15 §3.2, summed over the stocked variants. */
export function ProductKeyNumbers({ productId, runId }: ProductKeyNumbersProps) {
  const productItem = api.mrp.productItem.useQuery({ productId, runId })
  const loading = productItem.isLoading
  const data = productItem.data
  const totals = data?.totals

  if (!loading && !data?.run) {
    return (
      <EmptySection
        title='No plan run yet'
        description='Run MRP from Manage to plan this product.'
      />
    )
  }
  if (!loading && totals?.stocked === 0) {
    return (
      <EmptySection
        title='Nothing to plan'
        description={
          (data?.variants.length ?? 0) > 0
            ? "This product's variants are services"
            : 'No variants yet'
        }
      />
    )
  }
  if (!loading && totals?.inRun === 0) {
    return (
      <EmptySection
        title='Not in this plan run'
        description='The variants were added after the run, or the run skipped them.'
      />
    )
  }

  const variants = data?.variants ?? []
  const openPoLines = variants.reduce((sum, v) => sum + v.openPoLines, 0)
  const openBuilds = variants.reduce((sum, v) => sum + v.openBuilds, 0)
  const firstOrderBy = totals?.firstOrderBy ?? null
  const minCover = totals?.minCover ?? null
  // Surface the worst variant when the family average hides it (15 §3.2).
  const coverDescription =
    minCover && totals?.daysOfCover != null && minCover.days < totals.daysOfCover / 2
      ? `${variantName(data, minCover.partId)}: ${formatDays(minCover.days)}`
      : undefined

  return (
    <MetricGrid columns={3} className='overflow-hidden rounded-md border'>
      <MetricCell label='On hand' loading={loading} value={formatQty(totals?.onHand)} />
      <MetricCell
        label='On order'
        loading={loading}
        value={formatQty(totals?.onOrder)}
        description={onOrderDescription(openPoLines, openBuilds)}
      />
      <MetricCell
        label='Net flow'
        loading={loading}
        value={formatQty(totals?.netFlow)}
        description={totals?.openDemand ? `open demand ${formatQty(totals.openDemand)}` : undefined}
      />

      <MetricCell label='Avg daily use' loading={loading} value={formatQty(totals?.adu, 1)} />
      <MetricCell
        label='First stockout'
        loading={loading}
        value={formatDay(totals?.firstStockout?.day)}
        description={
          totals?.firstStockout ? variantName(data, totals.firstStockout.partId) : undefined
        }
      />
      <MetricCell
        label='First order by'
        loading={loading}
        value={formatDay(firstOrderBy?.day)}
        description={
          firstOrderBy
            ? [variantName(data, firstOrderBy.partId), firstOrderBy.isOverdue ? 'overdue' : null]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      />

      <MetricCell
        label='Days of cover'
        loading={loading}
        value={formatDays(totals?.daysOfCover)}
        description={coverDescription}
      />
      <MetricCell
        label='Suggestions'
        loading={loading}
        value={totals ? suggestionsLabel(totals.suggestions) : undefined}
      />
      <MetricCell
        label='Buffered'
        loading={loading}
        value={totals ? `${totals.buffered} of ${totals.stocked} variants` : undefined}
      />
    </MetricGrid>
  )
}
