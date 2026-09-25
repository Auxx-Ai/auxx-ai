// apps/web/src/components/mrp/ui/part/supply-section.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { FileText, Hammer } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useMemo } from 'react'
import { useResourceProperty } from '~/components/resources'
import { RecordLink } from '~/components/resources/ui/record-link'
import { api } from '~/trpc/react'
import { formatDay, formatQty, type MrpPartItemData } from './key-numbers'

type SupplyDoc =
  | { kind: 'po'; key: string; line: MrpPartItemData['openPoLines'][number] }
  | { kind: 'build'; key: string; build: MrpPartItemData['openBuilds'][number] }

const BUILD_STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress' } as const

/** Open issued PO lines and open builds for the part (02 §6.3), read live off `mrp.partItem`. */
export function SupplySection({ partId }: { partId: string }) {
  // Same `?run=` read as the tab, so this shares its `partItem` query.
  const [runParam] = useQueryState('run')
  const partItem = api.mrp.partItem.useQuery({ partId, runId: runParam || null })
  const purchaseOrderDefId = useResourceProperty('purchase_order', 'id')
  const buildDefId = useResourceProperty('build', 'id')

  const docs = useMemo<SupplyDoc[]>(
    () => [
      ...(partItem.data?.openPoLines ?? []).map((line) => ({
        kind: 'po' as const,
        key: `po:${line.lineId}`,
        line,
      })),
      ...(partItem.data?.openBuilds ?? []).map((build) => ({
        kind: 'build' as const,
        key: `build:${build.buildId}`,
        build,
      })),
    ],
    [partItem.data]
  )

  return (
    <Section title='Supply'>
      {!partItem.isLoading && docs.length === 0 ? (
        <EmptySection orientation='horizontal' title='Nothing on order' />
      ) : (
        <TreeRowList
          loading={partItem.isLoading}
          skeletonCount={2}
          className='gap-px'
          items={docs}
          getKey={(doc) => doc.key}
          renderRow={(doc) =>
            doc.kind === 'po' ? (
              <TreeRow
                icon={<FileText className='size-4' />}
                rowClassName='hover:bg-primary-100'
                title={
                  <RecordLink
                    recordId={
                      purchaseOrderDefId
                        ? toRecordId(purchaseOrderDefId, doc.line.purchaseOrderId)
                        : null
                    }
                    openInStack>
                    {doc.line.purchaseOrderNumber ?? 'Purchase order'}
                  </RecordLink>
                }
                secondary={doc.line.supplierName ?? undefined}
                actions={
                  <div className='flex items-center gap-3 pe-1 font-mono text-xs tabular-nums'>
                    <span className='text-foreground'>{formatQty(doc.line.quantityOpen)}</span>
                    <span>due {formatDay(doc.line.expectedAt)}</span>
                    {doc.line.lateDays ? (
                      <span className='text-amber-600'>{doc.line.lateDays} d late</span>
                    ) : null}
                  </div>
                }
              />
            ) : (
              <TreeRow
                icon={<Hammer className='size-4' />}
                rowClassName='hover:bg-primary-100'
                title={
                  <RecordLink
                    recordId={buildDefId ? toRecordId(buildDefId, doc.build.buildId) : null}
                    openInStack>
                    {doc.build.number ?? 'Build'}
                  </RecordLink>
                }
                secondary={BUILD_STATUS_LABEL[doc.build.status]}
                actions={
                  <div className='flex items-center gap-3 pe-1 font-mono text-xs tabular-nums'>
                    <span className='text-foreground'>{formatQty(doc.build.quantityOpen)}</span>
                    {doc.build.dueDay ? <span>due {formatDay(doc.build.dueDay)}</span> : null}
                  </div>
                }
              />
            )
          }
        />
      )}
    </Section>
  )
}
