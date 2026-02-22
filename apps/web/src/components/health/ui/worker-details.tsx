// apps/web/src/components/health/ui/worker-details.tsx
'use client'

import type { QueueHealth } from '@auxx/lib/health/client'
import { Section } from '@auxx/ui/components/section'
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
    <>
      <Section title='Summary' description='Active worker count across all queues' initialOpen>
        <div className='text-sm text-muted-foreground'>
          {details.queuesWithWorkers ?? 0} of {details.totalQueues ?? 0} queues have active workers
        </div>
      </Section>

      <Section title='Queues' description='Click a queue to view detailed metrics' initialOpen>
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
      </Section>
    </>
  )
}
