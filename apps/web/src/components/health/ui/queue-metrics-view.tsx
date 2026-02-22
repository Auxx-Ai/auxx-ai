// apps/web/src/components/health/ui/queue-metrics-view.tsx
'use client'

import type { QueueMetricsTimeRange } from '@auxx/lib/health/client'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
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

  const { data, isLoading } = api.admin.health.getQueueMetrics.useQuery(
    { queueName, timeRange },
    { refetchOnWindowFocus: false }
  )

  return (
    <>
      <div className='p-3 border-b'>
        <Button variant='ghost' size='sm' onClick={onBack}>
          <ChevronLeft /> Back to queues
        </Button>

        <div className='mt-2'>
          <h4 className='font-mono text-sm font-medium'>{queueName}</h4>
          <p className='text-xs text-muted-foreground'>
            {data?.workers ?? 0} active worker{(data?.workers ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>

        <div className='flex gap-1 mt-3'>
          {TIME_RANGES.map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'outline'}
              size='sm'
              onClick={() => setTimeRange(range)}>
              {range}
            </Button>
          ))}
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
            initialOpen>
            <StatRow label='Completed' value={data.completed.toLocaleString()} />
            <StatRow label='Failed' value={data.failed.toLocaleString()} />
            <StatRow label='Waiting' value={data.waiting.toLocaleString()} />
            <StatRow label='Active' value={data.active.toLocaleString()} />
            <StatRow label='Delayed' value={data.delayed.toLocaleString()} />
            <StatRow label='Failure Rate' value={`${data.failureRate}%`} />
          </Section>
        </>
      ) : null}
    </>
  )
}
