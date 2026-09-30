// apps/web/src/components/drawers/cards/order-builds-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Hammer } from 'lucide-react'
import {
  BUILD_STATUS_LABEL,
  BUILD_STATUS_VARIANT,
  formatBuildQuantity,
} from '~/components/manufacturing/builds/build-format'
import { openBuildSheet } from '~/components/manufacturing/builds/build-sheet-store'
import { toRecordId, useResourceProperty } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { RowSkeleton, TREE_SECONDARY_NOTRUNCATE } from './related-record-row'

/** The builds raised against this order; renders nothing (hiding the section) when there are none. */
export function OrderBuildsCard({ entityInstanceId }: DrawerTabProps) {
  const partDefId = useResourceProperty('part', 'id')
  const builds = api.builds.list.useQuery(
    { orderId: entityInstanceId, limit: 50 },
    { enabled: !!entityInstanceId }
  )
  const items = builds.data?.items ?? []

  if (builds.isPending) return <RowSkeleton />
  if (items.length === 0) return null

  return (
    <TreeRowList
      className={TREE_SECONDARY_NOTRUNCATE}
      items={items}
      getKey={(build) => build.buildId}
      renderRow={(build) => (
        <TreeRow
          icon={<Hammer className='size-4' />}
          rowClassName='hover:bg-primary-100'
          onToggleOpen={() => openBuildSheet(build.buildId)}
          title={<span className='font-mono text-sm'>{build.number}</span>}
          secondary={
            <span className='flex min-w-0 items-center gap-1.5'>
              <Badge variant={BUILD_STATUS_VARIANT[build.status]} size='xs'>
                {BUILD_STATUS_LABEL[build.status]}
              </Badge>
              {partDefId && (
                <RecordBadge recordId={toRecordId(partDefId, build.partId)} size='sm' />
              )}
            </span>
          }
          actions={
            <span className='pe-1 font-mono text-xs tabular-nums'>
              {formatBuildQuantity(build.quantityProduced ?? build.quantityPlanned)}
            </span>
          }
        />
      )}
    />
  )
}
