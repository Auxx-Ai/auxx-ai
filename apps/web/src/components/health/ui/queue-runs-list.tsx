// apps/web/src/components/health/ui/queue-runs-list.tsx
'use client'

import type { QueueRun } from '@auxx/lib/health/client'
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
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { Check, ChevronDown, Copy, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

type RunStatus = 'completed' | 'failed'

const PAGE_SIZE = 20

interface QueueRunsListProps {
  queueName: string
}

/**
 * Expandable section showing recent completed and failed job runs for a queue.
 * Uses a Select dropdown in the section header to toggle between statuses.
 */
export function QueueRunsList({ queueName }: QueueRunsListProps) {
  const [status, setStatus] = useState<RunStatus>('completed')

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    api.admin.health.getQueueRuns.useInfiniteQuery(
      { queueName, status, limit: PAGE_SIZE },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchOnWindowFocus: false,
      }
    )

  const runs = data?.pages.flatMap((page) => page.runs) ?? []

  return (
    <Section
      title='Runs'
      description='Recent job runs'
      actions={
        <Select value={status} onValueChange={(v) => setStatus(v as RunStatus)}>
          <SelectTrigger variant='default' size='sm' className='mb-0'>
            <SelectValue>{status === 'completed' ? 'Completed' : 'Failed'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='completed'>Completed</SelectItem>
            <SelectItem value='failed'>Failed</SelectItem>
          </SelectContent>
        </Select>
      }>
      {isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-12 w-full' />
          <Skeleton className='h-12 w-full' />
          <Skeleton className='h-12 w-full' />
        </div>
      ) : runs.length === 0 ? (
        <p className='text-sm text-muted-foreground py-4 text-center'>No {status} jobs found.</p>
      ) : (
        <>
          <div className='space-y-1'>
            {runs.map((run, i) => (
              <RunItem key={run.id ?? i} run={run} status={status} />
            ))}
          </div>

          {hasNextPage && (
            <div className='pt-3'>
              <Button
                variant='outline'
                size='sm'
                className='w-full'
                loading={isFetchingNextPage}
                loadingText='Loading...'
                onClick={() => fetchNextPage()}>
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

function RunItem({ run, status }: { run: QueueRun; status: RunStatus }) {
  const [expanded, setExpanded] = useState(false)
  const isCompleted = status === 'completed'
  const detail = isCompleted ? run.returnvalue : run.failedReason
  const { copied, copy } = useCopy({ toastMessage: 'Copied to clipboard' })

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const text = [
      `Job: ${run.name}`,
      `Status: ${isCompleted ? 'completed' : 'failed'}`,
      `Finished: ${run.finishedOn ?? 'N/A'}`,
      `Attempts: ${run.attemptsMade}`,
      detail ? `${isCompleted ? 'Result' : 'Error'}: ${detail}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    copy(text)
  }

  return (
    <div className='rounded-md border'>
      <div
        className='flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50'
        onClick={() => setExpanded((prev) => !prev)}>
        <div className='min-w-0 flex-1'>
          <div className='font-mono text-sm font-medium truncate'>{run.name}</div>
          <div className='flex items-center gap-2 text-xs text-muted-foreground mt-1'>
            {run.finishedOn && <span>{new Date(run.finishedOn).toLocaleString()}</span>}
            <span>&middot;</span>
            <span>
              {run.attemptsMade} attempt{run.attemptsMade !== 1 ? 's' : ''}
            </span>
            <span>&middot;</span>
            {isCompleted ? (
              <span className='inline-flex items-center gap-0.5 text-green-600'>
                <Check className='size-3' /> success
              </span>
            ) : (
              <span className='inline-flex items-center gap-0.5 text-red-500'>
                <X className='size-3' /> failed
              </span>
            )}
          </div>
        </div>
        <div className='flex items-center shrink-0'>
          <Button variant='ghost' size='sm' onClick={handleCopy}>
            {copied ? <Check className='size-3' /> : <Copy className='size-3' />}
          </Button>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {expanded && (
        <div className='border-t px-3 py-2'>
          {detail ? (
            <pre className='text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground'>
              {detail}
            </pre>
          ) : (
            <p className='text-xs text-muted-foreground'>No details available.</p>
          )}
        </div>
      )}
    </div>
  )
}
