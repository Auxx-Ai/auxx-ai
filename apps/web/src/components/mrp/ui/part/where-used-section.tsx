// apps/web/src/components/mrp/ui/part/where-used-section.tsx
'use client'

import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Boxes, ShoppingCart } from 'lucide-react'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api } from '~/trpc/react'
import { formatDay, StockStatusDot } from './key-numbers'

interface WhereUsedSectionProps {
  partId: string
  recordId: RecordId
  runId: string | null
}

/** Parents with their share of this part's consumption over the run window (02 §7a). */
export function WhereUsedSection({ partId, recordId, runId }: WhereUsedSectionProps) {
  const whereUsed = api.mrp.whereUsed.useQuery({ partId, runId })
  const { entityDefinitionId: partDefId } = parseRecordId(recordId)

  const parents = whereUsed.data?.parents ?? []
  const products = whereUsed.data?.products ?? []
  // Nothing uses it and it is not sold: the section has nothing to say.
  if (!whereUsed.isLoading && parents.length === 0) return null

  return (
    <Section
      title='Where used'
      secondary={products.length > 1 ? `shared with ${products.length} products` : undefined}>
      {whereUsed.isLoading ? (
        <EmptySection loading />
      ) : (
        <TreeRowList
          className='gap-px'
          items={parents}
          getKey={(p) => `${p.partId}:${p.isDirectSale}`}
          renderRow={(p) => (
            <TreeRow
              icon={
                p.isDirectSale ? <ShoppingCart className='size-4' /> : <Boxes className='size-4' />
              }
              title={
                p.isDirectSale ? (
                  'Sold directly'
                ) : (
                  <RecordLink recordId={toRecordId(partDefId, p.partId)} openInStack>
                    {p.name ?? 'Unnamed part'}
                  </RecordLink>
                )
              }
              description={
                !p.inBom && !p.isDirectSale
                  ? 'Named by history only; not on the current BOM'
                  : undefined
              }
              secondary={
                p.isDirectSale ? undefined : (
                  <span className='inline-flex items-center gap-2 text-xs'>
                    <StockStatusDot status={p.stockStatus} />
                    {p.item?.orderByDate ? (
                      <span>order by {formatDay(p.item.orderByDate)}</span>
                    ) : null}
                  </span>
                )
              }
              actions={
                <span className='pe-1 font-mono text-xs tabular-nums'>
                  {Math.round(p.share * 100)} %
                </span>
              }
            />
          )}
        />
      )}
    </Section>
  )
}
