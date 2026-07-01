// apps/web/src/components/health/ui/queue-metrics-view.tsx
'use client'

import type { CleanableJobState, QueueMetricsTimeRange } from '@auxx/lib/health/client'
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
import { ChevronLeft, Pause, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { QueueRunsList } from './queue-runs-list'
import { StatRow } from './stat-row'

const TIME_RANGES: QueueMetricsTimeRange[] = ['1H', '4H', '12H', '1D', '7D']

/** Job states offered in the clear-by-state control, with display labels */
const CLEAN_STATES: { value: CleanableJobState; label: string }[] = [
  { value: 'failed', label: 'Failed' },
  { value: 'completed', label: 'Completed' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'wait', label: 'Waiting' },
]

interface QueueMetricsViewProps {
  queueName: string
  onBack: () => void
}

/**
 * Queue detail view with time-range selector and stats.
 */
export function QueueMetricsView({ queueName, onBack }: QueueMetricsViewProps) {
  const [timeRange, setTimeRange] = useState<QueueMetricsTimeRange>('1H')
  const [cleanState, setCleanState] = useState<CleanableJobState>('failed')
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const { data, isLoading } = api.admin.health.getQueueMetrics.useQuery(
    { queueName, timeRange },
    { refetchOnWindowFocus: false }
  )

  const { data: schedulers } = api.admin.health.getQueueSchedulers.useQuery(
    { queueName },
    { refetchOnWindowFocus: false }
  )

  function invalidateQueue() {
    utils.admin.health.getQueueMetrics.invalidate({ queueName })
    utils.admin.health.getQueueRuns.invalidate({ queueName })
    utils.admin.health.getIndicator.invalidate({ id: 'worker' })
  }

  const cleanJobs = api.admin.health.cleanJobs.useMutation({ onSuccess: invalidateQueue })
  const drainQueue = api.admin.health.drainQueue.useMutation({ onSuccess: invalidateQueue })
  const pauseQueue = api.admin.health.pauseQueue.useMutation({ onSuccess: invalidateQueue })
  const resumeQueue = api.admin.health.resumeQueue.useMutation({ onSuccess: invalidateQueue })

  const removeScheduler = api.admin.health.removeScheduler.useMutation({
    onSuccess: () => {
      utils.admin.health.getQueueSchedulers.invalidate({ queueName })
      utils.admin.health.getQueueMetrics.invalidate({ queueName })
    },
  })

  const isPaused = data?.paused ?? false
  const pauseBusy = pauseQueue.isPending || resumeQueue.isPending

  async function handleTogglePause() {
    if (isPaused) {
      resumeQueue.mutate({ queueName })
      return
    }
    const confirmed = await confirm({
      title: 'Pause queue?',
      description: `Workers will stop picking up new jobs from the "${queueName}" queue. Jobs already in progress finish, and you can resume anytime.`,
      confirmText: 'Pause Queue',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      pauseQueue.mutate({ queueName })
    }
  }

  async function handleClean() {
    const label = CLEAN_STATES.find((s) => s.value === cleanState)?.label ?? cleanState
    const confirmed = await confirm({
      title: `Clear ${label.toLowerCase()} jobs?`,
      description: `This removes all ${label.toLowerCase()} jobs from the "${queueName}" queue. This cannot be undone.`,
      confirmText: 'Clear Jobs',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      cleanJobs.mutate({ queueName, state: cleanState })
    }
  }

  async function handleDrain() {
    const confirmed = await confirm({
      title: 'Drain pending jobs?',
      description: `This removes all waiting and delayed jobs from the "${queueName}" queue. Active jobs and completed/failed history are kept. This cannot be undone.`,
      confirmText: 'Drain Pending',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      drainQueue.mutate({ queueName })
    }
  }

  async function handleRemoveScheduler(schedulerId: string, name: string) {
    const confirmed = await confirm({
      title: 'Remove scheduler?',
      description: `This stops "${name}" from scheduling any further jobs on the "${queueName}" queue. Existing jobs are unaffected — clear failed jobs separately if needed.`,
      confirmText: 'Remove Scheduler',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      removeScheduler.mutate({ queueName, schedulerId })
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
            title='Controls'
            description='Pause processing or clear jobs on this queue.'
            initialOpen>
            <div className='space-y-3'>
              <div className='flex items-center justify-between gap-2'>
                <div className='text-sm'>
                  <div className='font-medium'>{isPaused ? 'Queue paused' : 'Queue running'}</div>
                  <div className='text-xs text-muted-foreground'>
                    {isPaused
                      ? 'Workers are not picking up new jobs.'
                      : 'Workers are picking up new jobs.'}
                  </div>
                </div>
                <Button variant='outline' size='sm' loading={pauseBusy} onClick={handleTogglePause}>
                  {isPaused ? <Play /> : <Pause />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
              </div>

              <div className='flex items-center justify-between gap-2'>
                <div className='text-sm'>
                  <div className='font-medium'>Clear jobs</div>
                  <div className='text-xs text-muted-foreground'>Remove all jobs in a state.</div>
                </div>
                <div className='flex items-center gap-2'>
                  <Select
                    value={cleanState}
                    onValueChange={(v) => setCleanState(v as CleanableJobState)}>
                    <SelectTrigger variant='default' size='sm' className='w-auto'>
                      <SelectValue>
                        {CLEAN_STATES.find((s) => s.value === cleanState)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CLEAN_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant='destructive'
                    size='sm'
                    loading={cleanJobs.isPending}
                    loadingText='Clearing...'
                    onClick={handleClean}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className='flex items-center justify-between gap-2'>
                <div className='text-sm'>
                  <div className='font-medium'>Drain pending</div>
                  <div className='text-xs text-muted-foreground'>
                    Remove all waiting + delayed jobs.
                  </div>
                </div>
                <Button
                  variant='destructive'
                  size='sm'
                  loading={drainQueue.isPending}
                  loadingText='Draining...'
                  onClick={handleDrain}>
                  Drain
                </Button>
              </div>
            </div>
          </Section>

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
            <StatRow label='Paused' value={isPaused ? 'Yes' : 'No'} />
          </Section>

          <Section
            title='Schedulers'
            description='Repeatable cron entries that spawn jobs. Remove an orphaned scheduler to stop a failing job from recurring.'
            initialOpen={false}>
            {schedulers && schedulers.length > 0 ? (
              <div className='space-y-1'>
                {schedulers.map((scheduler) => (
                  <div
                    key={scheduler.key}
                    className='flex items-center justify-between gap-2 rounded-md border px-3 py-2'>
                    <div className='min-w-0 flex-1'>
                      <div className='font-mono text-sm truncate'>{scheduler.name}</div>
                      <div className='text-xs text-muted-foreground'>
                        {scheduler.pattern ??
                          (scheduler.every ? `every ${scheduler.every}ms` : 'no schedule')}
                        {scheduler.next && ` · next ${new Date(scheduler.next).toLocaleString()}`}
                      </div>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      loading={
                        removeScheduler.isPending &&
                        removeScheduler.variables?.schedulerId === scheduler.key
                      }
                      onClick={() => handleRemoveScheduler(scheduler.key, scheduler.name)}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground py-2 text-center'>
                No schedulers registered.
              </p>
            )}
          </Section>

          <QueueRunsList queueName={queueName} />
        </>
      ) : null}

      <ConfirmDialog />
    </>
  )
}
