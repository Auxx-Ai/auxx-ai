// apps/web/src/components/mrp/ui/product/family-sell-through.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { Section } from '@auxx/ui/components/section'
import { AlertTriangle } from 'lucide-react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api } from '~/trpc/react'
import { formatDay, formatQty } from '../part/key-numbers'

interface FamilySellThroughSectionProps {
  productId: string
  runId: string | null
}

/** Family sell-through over the union of the stocked variants' BOMs; hidden when none has one (15 §3.4, D42). */
export function FamilySellThroughSection({ productId, runId }: FamilySellThroughSectionProps) {
  const query = api.mrp.productSellThrough.useQuery({ productId, runId })
  const data = query.data
  if (!data || data.withBom === 0) return null

  const limiting = data.limiting

  return (
    <Section title='Sell-through'>
      <MetricGrid columns={3} className='overflow-hidden rounded-md border'>
        <MetricCell
          label='Limiting part'
          value={
            limiting ? (
              <RecordLink
                recordId={toRecordId('part', limiting.partId)}
                link={{ tab: 'mrp' }}
                openInStack>
                {limiting.name ?? 'Unnamed part'}
              </RecordLink>
            ) : (
              EMPTY_CELL
            )
          }
          description={
            !limiting
              ? 'No component runs out'
              : limiting.variantCount > 1
                ? `shared by ${limiting.variantCount} variants`
                : undefined
          }
        />
        <MetricCell label='Runs out' value={formatDay(limiting?.stockoutDate)} />
        <MetricCell
          label='Order it by'
          value={formatDay(limiting?.orderByDate)}
          description={
            [limiting?.isOverdue ? 'overdue' : null, limiting?.supplier?.name]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />

        <MetricCell label='Sold, 30 d' value={formatQty(data.sold, 0)} />
        <MetricCell
          label='Built, 30 d'
          value={formatQty(data.built, 0)}
          description={
            data.unbuilt > 0 ? (
              <span className='inline-flex items-center gap-1 text-amber-600'>
                <AlertTriangle className='size-3' />
                {formatQty(data.unbuilt, 0)} unbuilt
              </span>
            ) : undefined
          }
        />
        <MetricCell label='Variants with a BOM' value={`${data.withBom} of ${data.stocked}`} />
      </MetricGrid>
    </Section>
  )
}
