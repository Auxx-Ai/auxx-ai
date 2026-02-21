// apps/web/src/components/health/ui/worker-details.tsx
'use client'

import type { QueueHealth } from '@auxx/lib/health/client'
import { Separator } from '@auxx/ui/components/separator'
import { useState } from 'react'
import { QueueMetricsView } from './queue-metrics-view'
import { StatusDot } from './status-dot'

interface WorkerDetailsProps {
  details: Record<string, any>
  queues?: QueueHealth[]
}

/**
 * Worker indicator detail view — queue list + drill-down metrics.
 */
export function WorkerDetails({ details, queues }: WorkerDetailsProps) {
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null)

  if (selectedQueue) {
    return <QueueMetricsView queueName={selectedQueue} onBack={() => setSelectedQueue(null)} />
  }

  return (
    <div className='space-y-4'>
      <div className='text-sm text-muted-foreground'>
        {details.queuesWithWorkers ?? 0} of {details.totalQueues ?? 0} queues have active workers
      </div>

      <Separator />

      <div className='space-y-1'>
        {queues?.map((queue) => (
          <div
            key={queue.queueName}
            className='flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-muted/50'
            onClick={() => setSelectedQueue(queue.queueName)}>
            <div>
              <div className='font-mono text-sm'>{queue.queueName}</div>
              <div className='text-xs text-muted-foreground'>
                {queue.workers} worker{queue.workers !== 1 ? 's' : ''} | {queue.metrics.active}{' '}
                active | {queue.metrics.waiting} waiting
              </div>
            </div>
            <StatusDot status={queue.status} />
          </div>
        ))}
      </div>
    </div>
  )
}
