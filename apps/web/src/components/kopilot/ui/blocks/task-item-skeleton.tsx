// apps/web/src/components/kopilot/ui/blocks/task-item-skeleton.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { format } from 'date-fns'
import { Check, CircleDashed } from 'lucide-react'
import type { TaskSnapshotData } from './block-schemas'

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
  return (
    <div className='flex items-start gap-2 px-2 py-2 text-sm'>
      {isCompleted ? (
        <Check className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      ) : (
        <CircleDashed className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'truncate',
              isCompleted && 'text-muted-foreground line-through',
              isDeleted && 'text-muted-foreground'
            )}>
            {snapshot.title}
          </span>
          {isDeleted && (
            <Badge variant='outline' className='shrink-0 text-[10px] uppercase'>
              Deleted
            </Badge>
          )}
        </div>
        {snapshot.deadline && (
          <div className='mt-0.5 text-xs text-muted-foreground'>
            {format(new Date(snapshot.deadline), 'MMM d, yyyy')}
          </div>
        )}
      </div>
    </div>
  )
}
