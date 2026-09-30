// apps/web/src/components/drawers/cards/order-builds-card.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Hammer } from 'lucide-react'
import { useCanOpenBuilds } from '~/components/manufacturing/builds/build-badge'
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

const PAGE_SIZE = 50

/** The builds raised against this order; renders nothing (hiding the section) when there are none. */
export function OrderBuildsCard({ entityInstanceId }: DrawerTabProps) {
  const partDefId = useResourceProperty('part', 'id')
  // `builds.list` asserts `mrp.view`; without it the section stays hidden.
  const canView = useCanOpenBuilds()
  const builds = api.builds.list.useInfiniteQuery(
    { orderId: entityInstanceId, limit: PAGE_SIZE },
    { enabled: !!entityInstanceId && canView, getNextPageParam: (page) => page.nextCursor }
  )
  const items = builds.data?.pages.flatMap((page) => page.items) ?? []

  if (!canView) return null
  if (builds.isPending) return <RowSkeleton />
  if (items.length === 0) return null

  return (
    <div className='space-y-1'>
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
                {build.drifted && (
                  <Badge variant='amber' size='xs'>
                    Order changed
                  </Badge>
                )}
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
      {builds.hasNextPage && (
        <div className='flex justify-center'>
          <Button
            variant='ghost'
            size='xs'
            loading={builds.isFetchingNextPage}
            loadingText='Loading...'
            onClick={() => builds.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
