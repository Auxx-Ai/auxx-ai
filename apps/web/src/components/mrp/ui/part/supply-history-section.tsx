// apps/web/src/components/mrp/ui/part/supply-history-section.tsx
'use client'

import { MRP_EXCLUSION_LABELS } from '@auxx/lib/mrp/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { FileText } from 'lucide-react'
import { useResourceProperty } from '~/components/resources'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api } from '~/trpc/react'
import { formatDay, formatDays, openPurchaseLines, type SupplyHistoryLineData } from './key-numbers'

/** Per PO line: ordered, expected and received, with lead time, lateness and fill (02 §6.2). */
export function SupplyHistorySection({ partId }: { partId: string }) {
  const history = api.mrp.supplyHistory.useQuery({ partId })
  const purchaseOrderDefId = useResourceProperty('purchase_order', 'id')

  // Open lines are the Supply section's; this lists what has landed or been excluded.
  const open = new Set(openPurchaseLines(history.data).map((l) => l.purchaseOrderLineId))
  const lines: SupplyHistoryLineData[] = (history.data?.vendorParts ?? [])
    .flatMap((vp) =>
      vp.lines.map((l) => ({ ...l, supplierId: vp.supplierId, supplierName: vp.supplierName }))
    )
    .filter((l) => !open.has(l.purchaseOrderLineId))
    .sort((a, b) => ((a.orderedAt ?? '') < (b.orderedAt ?? '') ? 1 : -1))

  return (
    <Section title='Supply history'>
      {!history.isLoading && lines.length === 0 ? (
        <EmptySection orientation='horizontal' title='No purchase history' />
      ) : (
        <TreeRowList
          loading={history.isLoading}
          className='@container gap-px'
          items={lines}
          getKey={(l) => l.purchaseOrderLineId}
          renderRow={(l) => {
            const excluded = l.excludedReason ? MRP_EXCLUSION_LABELS[l.excludedReason] : null
            const obs = l.observation
            return (
              <TreeRow
                icon={<FileText className='size-4' />}
                rowClassName={cn('hover:bg-primary-100', excluded && 'opacity-50')}
                title={
                  <RecordLink
                    recordId={
                      purchaseOrderDefId ? toRecordId(purchaseOrderDefId, l.purchaseOrderId) : null
                    }
                    openInStack>
                    {l.purchaseOrderName ?? 'Purchase order'}
                  </RecordLink>
                }
                description={excluded?.why}
                secondary={excluded ? excluded.label : (l.supplierName ?? undefined)}
                actions={
                  excluded ? undefined : (
                    <div className='flex items-center gap-3 pe-1 font-mono text-xs tabular-nums'>
                      <span className='hidden @md:inline'>ordered {formatDay(l.orderedAt)}</span>
                      <span className='hidden @md:inline'>expected {formatDay(l.expectedAt)}</span>
                      <span>received {formatDay(l.lastReceivedAt)}</span>
                      <span className='text-foreground'>{formatDays(obs?.leadTimeDays)}</span>
                      {obs?.latenessDays ? (
                        <span className={cn(obs.latenessDays > 0 && 'text-amber-600')}>
                          {obs.latenessDays > 0
                            ? `${obs.latenessDays} d late`
                            : `${-obs.latenessDays} d early`}
                        </span>
                      ) : null}
                      <span>{obs ? `${Math.round(obs.fill * 100)} %` : null}</span>
                    </div>
                  )
                }
              />
            )
          }}
        />
      )}
    </Section>
  )
}
