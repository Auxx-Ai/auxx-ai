// apps/web/src/components/kopilot/ui/blocks/task-item-skeleton.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { Check, CircleDashed } from 'lucide-react'
import { parseBlockDate } from './block-date'
import type { TaskSnapshotData } from './block-schemas'

/**
 * Shared wrapper classes — must mirror TaskItem (apps/web/src/components/tasks/ui/task-item.tsx)
 * so loading / snapshot / live rows all occupy the same vertical footprint.
 */
const TASK_ROW_WRAPPER = cn(
  'relative flex gap-2 ps-1 pe-2 py-1.5',
  'bg-illustration ring-border-illustration rounded-xl border border-transparent',
  'shadow shadow-black/10 ring-1'
)

interface TaskItemSkeletonProps {
  snapshot: TaskSnapshotData
  isDeleted?: boolean
}

/**
 * Rendered when a task referenced by a reference block has no live record
 * (pending hydration or permanently deleted). Shows title + deadline +
 * completion state from the snapshot. No checkbox, no dialog.
 */
export function TaskItemSkeleton({ snapshot, isDeleted }: TaskItemSkeletonProps) {
  const isCompleted = !!snapshot.completedAt
  const deadline = parseBlockDate(snapshot.deadline)
  return (
    <div className={cn(TASK_ROW_WRAPPER, (isCompleted || isDeleted) && 'opacity-60')}>
      {isCompleted ? (
        <Check className='mt-1 size-4 shrink-0 text-muted-foreground' />
      ) : (
        <CircleDashed className='mt-1 size-4 shrink-0 text-muted-foreground' />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-start justify-between gap-2'>
          <span
            className={cn(
              'flex-1 truncate text-sm leading-6',
              isCompleted && 'line-through text-muted-foreground',
              isDeleted && 'text-muted-foreground'
            )}>
            {snapshot.title}
          </span>
          {deadline && (
            <span className='flex-shrink-0 text-xs leading-6 text-muted-foreground'>
              {format(deadline, 'MMM d, yyyy')}
            </span>
          )}
        </div>
        {isDeleted && (
          <div className='mt-0.5'>
            <Badge variant='outline' className='text-[10px] uppercase'>
              Deleted
            </Badge>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Pure loading placeholder — same outer dimensions as TaskItem, no content.
 * Used when neither a live task nor a snapshot is available yet.
 */
export function TaskRowLoading() {
  return (
    <div className={TASK_ROW_WRAPPER}>
      <CircleDashed className='mt-1 size-4 shrink-0 text-muted-foreground/40' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center justify-between gap-2'>
          <Skeleton className='my-1 h-4 w-2/3' />
          <Skeleton className='my-1 h-3 w-16 shrink-0' />
        </div>
      </div>
    </div>
  )
}

/**
 * Row-shaped placeholder for tasks the server confirmed do not exist.
 * Same outer chrome as TaskItem so the list does not reflow.
 */
export function TaskRowUnavailable({ taskId }: { taskId: string }) {
  return (
    <div className={cn(TASK_ROW_WRAPPER, 'opacity-60')}>
      <CircleDashed className='mt-1 size-4 shrink-0 text-muted-foreground' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2 text-sm leading-6 text-muted-foreground'>
          <span className='shrink-0'>Task unavailable</span>
          <span className='truncate font-mono text-[10px] opacity-70'>{taskId}</span>
        </div>
      </div>
    </div>
  )
}
