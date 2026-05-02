// apps/web/src/components/tasks/ui/task-badge.tsx

'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { CheckCircle2, CircleDot } from 'lucide-react'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { useTask } from '../hooks/use-task'

interface TaskBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** Task ID — optional, shows loading when undefined */
  taskId?: string | null
  /** Whether to show the leading icon (default: true) */
  showIcon?: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Badge for a task — displays a status icon (open vs. completed) and the task title.
 * Mirrors RecordBadge's variants/sizes by reusing `recordBadgeVariants`.
 */
export function TaskBadge({
  taskId,
  showIcon = true,
  className,
  variant,
  size,
  ...props
}: TaskBadgeProps) {
  const { task, isLoading } = useTask({ taskId: taskId ?? '', enabled: !!taskId })

  const completed = !!task?.completedAt
  const Icon = completed ? CheckCircle2 : CircleDot
  const displayName = task?.title?.trim() || 'Untitled task'
  const showLoading = !taskId || (isLoading && !task)

  return (
    <div
      data-slot='task-badge'
      aria-busy={showLoading}
      className={cn(recordBadgeVariants({ variant, size }), className)}
      {...props}>
      {showLoading ? (
        <>
          {showIcon && <Skeleton />}
          <Skeleton />
        </>
      ) : (
        <>
          {showIcon && <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />}
          <span data-slot='record-display' className='truncate'>
            {displayName}
          </span>
        </>
      )}
    </div>
  )
}
