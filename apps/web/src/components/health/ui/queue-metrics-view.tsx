// apps/web/src/components/health/ui/queue-metrics-view.tsx
'use client'

import type { QueueMetricsTimeRange } from '@auxx/lib/health/client'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { QueueRunsList } from './queue-runs-list'
import { StatRow } from './stat-row'

const TIME_RANGES: QueueMetricsTimeRange[] = ['1H', '4H', '12H', '1D', '7D']

interface QueueMetricsViewProps {
  queueName: string
  onBack: () => void
}

/**
 * Queue detail view with time-range selector and stats.
 */
export function QueueMetricsView({ queueName, onBack }: QueueMetricsViewProps) {
  const [timeRange, setTimeRange] = useState<QueueMetricsTimeRange>('1H')
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data, isLoading } = api.admin.health.getQueueMetrics.useQuery(
    { queueName, timeRange },
    { refetchOnWindowFocus: false }
  )

  const clearFailed = api.admin.health.clearFailedJobs.useMutation({
    onSuccess: () => {
      utils.admin.health.getQueueMetrics.invalidate({ queueName })
      utils.admin.health.getQueueRuns.invalidate({ queueName })
      utils.admin.health.getIndicator.invalidate({ id: 'worker' })
    },
  })

  async function handleClearFailed() {
    const confirmed = await confirm({
      title: 'Clear failed jobs?',
      description: `This will remove all failed jobs from the "${queueName}" queue and reset the failure rate.`,
      confirmText: 'Clear Failed Jobs',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      clearFailed.mutate({ queueName })
    }
  }

  return (
    <>
      <div className='p-3 border-b'>
        <Button variant='outline' size='sm' onClick={onBack}>
          <ChevronLeft /> Back to queues
        </Button>

        <div className='mt-2 flex items-center justify-between'>
          <div>
            <h4 className='font-mono text-sm font-medium'>{queueName}</h4>
            <p className='text-xs text-muted-foreground'>
              {data?.workers ?? 0} active worker{(data?.workers ?? 0) !== 1 ? 's' : ''}
            </p>
          </div>
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as QueueMetricsTimeRange)}>
            <SelectTrigger variant='default' size='sm' className='w-auto'>
              <SelectValue>{timeRange}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((range) => (
                <SelectItem key={range} value={range}>
                  {range}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className='p-3'>
          <Skeleton className='h-48 w-full' />
        </div>
      ) : data ? (
        <>
          <div className='p-3 border-b'>
            <div className='h-48 bg-muted/30 rounded-lg flex items-center justify-center text-sm text-muted-foreground'>
              <div className='text-center'>
                <div className='text-2xl font-mono'>{data.completed.toLocaleString()}</div>
                <div className='text-xs'>completed</div>
                {data.failed > 0 && (
                  <>
                    <div className='text-xl font-mono text-red-500 mt-2'>
                      {data.failed.toLocaleString()}
                    </div>
                    <div className='text-xs text-red-500'>failed</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <Section
            title='Metrics'
            description='Job counts and failure rate for selected time range'
            initialOpen={false}>
            <StatRow label='Completed' value={data.completed.toLocaleString()} />
            <StatRow label='Failed' value={data.failed.toLocaleString()} />
            <StatRow label='Waiting' value={data.waiting.toLocaleString()} />
            <StatRow label='Active' value={data.active.toLocaleString()} />
            <StatRow label='Delayed' value={data.delayed.toLocaleString()} />
            <StatRow label='Failure Rate' value={`${data.failureRate}%`} />

            {data.failed > 0 && (
              <div className='pt-3'>
                <Button
                  variant='destructive'
                  size='sm'
                  loading={clearFailed.isPending}
                  loadingText='Clearing...'
                  onClick={handleClearFailed}>
                  Clear Failed Jobs
                </Button>
              </div>
            )}
          </Section>

          <QueueRunsList queueName={queueName} />
        </>
      ) : null}

      <ConfirmDialog />
    </>
  )
}
