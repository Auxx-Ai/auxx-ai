// apps/web/src/components/mrp/ui/product/product-mrp-tab.tsx
'use client'

import { parseRecordId } from '@auxx/lib/resources/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { useQueryState } from 'nuqs'
import type { DetailViewTabProps } from '~/components/detail-view/types'
import { api } from '~/trpc/react'
import { PositionChart } from '../charts/position-chart'
import { FamilySellThroughSection } from './family-sell-through'
import { ProductFlagsSection } from './product-flags-section'
import { ProductKeyNumbers } from './product-key-numbers'
import { VariantsSection } from './variants-section'

/** The product's Planning tab (`product:mrp`, 15 §3): the stored run rolled up over its variants. */
export function ProductMrpTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { entityInstanceId: productId } = parseRecordId(recordId)
  // Read `?run=` here rather than through the module's run hook so the tab works on any surface.
  const [runParam] = useQueryState('run')
  const runId = runParam || null

  const productItem = api.mrp.productItem.useQuery({ productId, runId })
  const nothingStocked = productItem.data?.totals.stocked === 0

  const sections = (
    <>
      {nothingStocked ? null : (
        <PositionChart
          source={{ kind: 'product', productId }}
          runId={runId}
          variant={variant === 'section' ? 'section' : 'page'}
        />
      )}
      <Section title='Key numbers'>
        <ProductKeyNumbers productId={productId} runId={runId} />
      </Section>
      <VariantsSection productId={productId} runId={runId} />
      <FamilySellThroughSection productId={productId} runId={runId} />
      <ProductFlagsSection productId={productId} runId={runId} />
    </>
  )

  if (variant === 'section') return <div className='flex flex-col'>{sections}</div>
  return <ScrollArea className='flex-1'>{sections}</ScrollArea>
}
