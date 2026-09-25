// apps/web/src/components/mrp/ui/part/part-mrp-tab.tsx
'use client'

import { parseRecordId } from '@auxx/lib/resources/client'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { useQueryState } from 'nuqs'
import type { DetailViewTabProps } from '~/components/detail-view/types'
import { isServiceKind } from '~/components/drawers/part-kind-gates'
import { api } from '~/trpc/react'
import { PositionChart } from '../charts/position-chart'
import { BomTreeSection } from './bom-tree'
import { FlagsSection } from './flags-section'
import { KeyNumbers } from './key-numbers'
import { MrpSettingsPanel } from './mrp-settings-panel'
import { SeasonalityStrip } from './seasonality-strip'
import { SellThroughSection } from './sell-through'
import { SupplyHistorySection } from './supply-history-section'
import { SupplySection } from './supply-section'
import { WhereUsedSection } from './where-used-section'

/** The part's Planning tab (`part:mrp`, 07 §4.5): the stored run's projection for this part. */
export function PartMrpTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  const { entityInstanceId: partId } = parseRecordId(recordId)
  // Read `?run=` here rather than through the module's run hook so the tab works on any surface.
  const [runParam] = useQueryState('run')
  const runId = runParam || null

  const partItem = api.mrp.partItem.useQuery({ partId, runId })
  // The kind gate hides the tab; this covers a surface that renders it without the gate (Q31).
  if (isServiceKind(partItem.data?.part?.kind)) return null
  const hasBom = (partItem.data?.bom.length ?? 0) > 0

  const sections = (
    <>
      <PositionChart
        partId={partId}
        runId={runId}
        variant={variant === 'section' ? 'section' : 'page'}
      />
      <Section title='Key numbers'>
        <KeyNumbers partId={partId} recordId={recordId} runId={runId} />
      </Section>
      <SeasonalityStrip partId={partId} runId={runId} />
      {hasBom ? (
        <>
          <SellThroughSection partId={partId} runId={runId} />
          <BomTreeSection partId={partId} runId={runId} />
        </>
      ) : null}
      <SupplySection partId={partId} />
      <WhereUsedSection partId={partId} recordId={recordId} runId={runId} />
      <SupplyHistorySection partId={partId} />
      <FlagsSection partId={partId} runId={runId} />
      <MrpSettingsPanel partId={partId} recordId={recordId} runId={runId} />
    </>
  )

  if (variant === 'section') return <div className='flex flex-col'>{sections}</div>
  return <ScrollArea className='flex-1'>{sections}</ScrollArea>
}
