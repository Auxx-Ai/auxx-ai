// apps/web/src/components/health/health-detail-drawer.tsx
'use client'

import type { HealthIndicatorId } from '@auxx/lib/health/client'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Activity } from 'lucide-react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { AppDetails } from './ui/app-details'
import { DatabaseDetails } from './ui/database-details'
import { JobsDetails } from './ui/jobs-details'
import { RedisDetails } from './ui/redis-details'
import { StatusDot } from './ui/status-dot'
import { WorkerDetails } from './ui/worker-details'

interface HealthDetailDrawerProps {
  indicatorId: HealthIndicatorId | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Map indicator ID to its detail component */
const DETAIL_COMPONENTS: Record<
  HealthIndicatorId,
  React.ComponentType<{ details: Record<string, any>; queues?: any[] }>
> = {
  database: DatabaseDetails,
  redis: RedisDetails,
  worker: WorkerDetails,
  jobs: JobsDetails,
  app: AppDetails,
}

/**
 * Right-side drawer showing detailed health info for a single indicator.
 */
export function HealthDetailDrawer({ indicatorId, open, onOpenChange }: HealthDetailDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const { data, isLoading } = api.admin.health.getIndicator.useQuery(
    { id: indicatorId! },
    { enabled: !!indicatorId && open, refetchOnWindowFocus: false }
  )

  if (!open || !indicatorId) return null

  const DetailComponent = DETAIL_COMPONENTS[indicatorId]

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={400}
      maxWidth={600}
      title={data?.label ?? indicatorId}>
      <DrawerHeader
        icon={<Activity className='h-4 w-4' />}
        title={data?.label ?? indicatorId}
        actions={<DockToggleButton />}
        onClose={() => onOpenChange(false)}
      />

      <div className='flex gap-3 py-2 px-3 flex-row items-center justify-between border-b'>
        <div className='flex flex-col'>
          <div className='text-lg font-medium'>
            {!data ? <Skeleton className='h-6 w-40' /> : data.label}
          </div>
          <div className='text-xs text-muted-foreground'>
            {!data ? <Skeleton className='h-4 w-60' /> : data.description}
          </div>
        </div>
        {data && <StatusDot status={data.status} showLabel />}
      </div>

      <ScrollArea className='flex-1'>
        <div className='p-4'>
          {isLoading ? (
            <div className='space-y-3'>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full' />
              ))}
            </div>
          ) : data?.errorMessage ? (
            <div className='text-sm text-red-600 bg-red-50 p-3 rounded-md'>{data.errorMessage}</div>
          ) : data?.details ? (
            <DetailComponent details={data.details} queues={data.queues} />
          ) : (
            <p className='text-muted-foreground text-sm'>No details available.</p>
          )}
        </div>
      </ScrollArea>
    </DockableDrawer>
  )
}
