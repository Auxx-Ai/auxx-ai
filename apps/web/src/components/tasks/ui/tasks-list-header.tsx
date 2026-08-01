// apps/web/src/components/tasks/ui/tasks-list-header.tsx

'use client'

import type { ActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import type { TaskGroupVariant } from '../utils/group-tasks'

/**
 * Props for TasksListHeader component
 */
interface TasksListHeaderProps {
  /** Group title (e.g., "Today", "Overdue"). Empty for assignee groups. */
  title: string
  /** Number of tasks in this group */
  count: number
  /** Visual variant for urgency/type indication */
  variant?: TaskGroupVariant
  /** Optional metadata (the assignee this group belongs to) */
  meta?: {
    actorId?: ActorId
  }
  /** Whether the group is collapsed */
  isCollapsed: boolean
  /** Toggle collapse state */
  onToggle: () => void
}

/** Variant styles for the badge */
const VARIANT_STYLES: Record<TaskGroupVariant, string> = {
  danger: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  warning: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  success: 'bg-good-100 text-good-700 dark:bg-good-900/30 dark:text-good-400',
  muted: 'bg-muted text-muted-foreground',
  default: '',
}

/**
 * TasksListHeader renders the header for a task group.
 * Shows group name, task count, optional avatar, and collapse toggle.
 */
export function TasksListHeader({
  title,
  count,
  variant = 'default',
  meta,
  isCollapsed,
  onToggle,
}: TasksListHeaderProps) {
  const variantClass = VARIANT_STYLES[variant] ?? ''

  return (
    <div className='flex items-center gap-2 pb-1'>
      {/* Assignee groups resolve their own name/avatar from the actor id */}
      {meta?.actorId ? (
        <ActorBadge actorId={meta.actorId} size='sm' />
      ) : (
        <Badge variant='pill' size='sm' className={cn(variantClass)}>
          {title}
        </Badge>
      )}

      {/* Task Count */}
      <span className='text-xs text-muted-foreground'>
        {count} {count === 1 ? 'task' : 'tasks'}
      </span>

      {/* Divider Line */}
      <span className='h-px flex-1 bg-primary-100 dark:bg-[#ffffff1d]' role='none' />

      {/* Collapse Toggle */}
      <Button
        type='button'
        size='icon-xs'
        variant='ghost'
        onClick={onToggle}
        aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}>
        {isCollapsed ? <ChevronRight /> : <ChevronDown />}
      </Button>
    </div>
  )
}
