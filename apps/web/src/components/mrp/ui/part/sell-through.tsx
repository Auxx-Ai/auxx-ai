// apps/web/src/components/mrp/ui/part/sell-through.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { AlertTriangle } from 'lucide-react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { Tooltip } from '~/components/global/tooltip'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api } from '~/trpc/react'
import { formatDay, formatQty } from './key-numbers'

interface SellThroughSectionProps {
  partId: string
  runId?: string | null
}

/** "Can I keep selling or building this": the limiting part, the buildable ceiling, 30-day sold vs built (07 §4.6). */
export function SellThroughSection({ partId, runId }: SellThroughSectionProps) {
  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  const query = api.mrp.sellThrough.useQuery({ partId, runId })

  if (!partItem.data || partItem.data.bom.length === 0) return null

  const loading = query.isLoading
  const data = query.data
  const limiting = data?.limiting ?? null
  const ceiling = data?.ceiling ?? null

  return (
    <Section title='Sell-through'>
      <MetricGrid columns={3} className='overflow-hidden rounded-md border'>
        <MetricCell
          label='Limiting part'
          loading={loading}
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
          description={limiting ? undefined : 'No component runs out'}
        />
        <MetricCell label='Runs out' loading={loading} value={formatDay(limiting?.stockoutDate)} />
        <MetricCell
          label='Order it by'
          loading={loading}
          value={formatDay(limiting?.orderByDate)}
          description={
            [limiting?.isOverdue ? 'overdue' : null, limiting?.supplier?.name]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />

        <MetricCell label='Buildable now'>
          {loading ? (
            <Skeleton className='h-5 w-20' />
          ) : ceiling ? (
            <div className='min-w-0'>
              <div className='truncate font-semibold text-sm tabular-nums'>
                up to {formatQty(ceiling.quantity, 0)}
              </div>
              <div className='truncate text-muted-foreground text-xs'>
                <Tooltip content='The least, over direct components, of on hand ÷ quantity per. Shared stock is not reserved, so every product using it sees the whole pool.'>
                  <span className='underline decoration-dotted'>ceiling</span>
                </Tooltip>
                , set by {ceiling.name ?? 'a component'}
                {ceiling.parentCount > 1 ? ` shared ×${ceiling.parentCount}` : ''}
              </div>
            </div>
          ) : (
            <div className='font-semibold text-sm'>{EMPTY_CELL}</div>
          )}
        </MetricCell>
        <MetricCell label='Sold, 30 d' loading={loading} value={formatQty(data?.sold)} />
        <MetricCell
          label='Built, 30 d'
          loading={loading}
          value={formatQty(data?.built)}
          description={
            data && data.unbuilt > 0 ? (
              <span className='inline-flex items-center gap-1 text-amber-600'>
                <AlertTriangle className='size-3' />
                {formatQty(data.unbuilt)} unbuilt
              </span>
            ) : undefined
          }
        />
      </MetricGrid>
    </Section>
  )
}
