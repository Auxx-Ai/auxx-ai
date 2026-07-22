// apps/web/src/components/tasks/ui/task-item.tsx

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { ActorId } from '@auxx/types/actor'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { AlarmClock } from 'lucide-react'
import { ParsedText } from '~/components/editor/parsed-text'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import { useTaskCompletion } from '../hooks/use-task-completion'
import {
  useTaskEffectiveCompletedAt,
  useTaskHasPendingCompletion,
} from '../hooks/use-task-effective-state'
import { formatTaskDeadline, formatTaskDeadlineDisplay } from '../utils/group-tasks-by-period'
import { TaskCheckbox } from './task-checkbox'
import { TaskOriginBadge } from './task-origin-badge'

/**
 * Props for TaskItem component
 */
interface TaskItemProps {
  /** Task data with relations */
  task: TaskWithRelations
  /** Click handler for opening task dialog (excludes checkbox area) */
  onClick: () => void
  /** Show linked entity badges (useful in global view) */
  showEntityReferences?: boolean
}

/**
 * TaskItem renders a single task row with checkbox, title, and metadata.
 * Clicking the checkbox toggles completion, clicking elsewhere opens the dialog.
 */
export function TaskItem({ task, onClick, showEntityReferences = false }: TaskItemProps) {
  const { toggleCompletion } = useTaskCompletion()

  // Use effective state (pending || stored)
  const effectiveCompletedAt = useTaskEffectiveCompletedAt(task.id)
  const hasPending = useTaskHasPendingCompletion(task.id)

  const isCompleted = !!effectiveCompletedAt

  /**
   * Handle checkbox change
   */
  const handleCheckboxChange = (checked: boolean) => {
    toggleCompletion(task.id, !checked)
  }

  const hasReferences = showEntityReferences && task.references && task.references.length > 0
  const hasAssignments = task.assignments && task.assignments.length > 0
  const hasOrigin = task.source !== 'manual'
  const isSnoozedIntoFuture =
    !!task.snoozedUntil && new Date(task.snoozedUntil).getTime() > Date.now()
  const hasPriorBadges = hasReferences || hasAssignments

  return (
    <div
      className={cn(
        'relative flex gap-2 ps-1 pe-2 py-1.5',
        'bg-illustration ring-border-illustration rounded-xl border border-transparent',
        'shadow shadow-black/10 ring-1 transition-all duration-200',
        'hover:bg-illustration/50 cursor-pointer',
        isCompleted && 'opacity-60',
        hasPending && 'ring-primary/30' // Subtle visual hint for pending state
      )}>
      {/* Checkbox (stops propagation) */}
      <div onClick={(e) => e.stopPropagation()}>
        <TaskCheckbox
          checked={isCompleted}
          onCheckedChange={handleCheckboxChange}
          // Never disabled - allows rapid toggle for undo
        />
      </div>

      {/* Content (clickable for dialog) */}
      <div className='flex-1 min-w-0' onClick={onClick}>
        <div className='flex items-start justify-between gap-2'>
          {/* Title and Metadata */}
          <div className='flex-1 min-w-0'>
            <div
              className={cn(
                'text-sm text-primary-600 dark:text-primary-400 leading-6',
                isCompleted && 'line-through'
              )}>
              <ParsedText>{task.title}</ParsedText>
              <span className='inline-block w-2' />

              {hasReferences && (
                <ItemsListView
                  inline
                  className='ms-1'
                  items={task.references}
                  renderItem={(recordId) => (
                    <RecordBadge
                      recordId={recordId as string}
                      showIcon
                      variant='default'
                      size='sm'
                    />
                  )}
                  maxDisplay={3}
                />
              )}

              {hasReferences && hasAssignments && (
                <span className='inline-flex align-middle mx-1 h-4 w-px bg-border' />
              )}

              {hasAssignments && (
                <ItemsListView
                  inline
                  className='ms-1'
                  items={task.assignments}
                  renderItem={(actorId) => <ActorBadge actorId={actorId as ActorId} size='sm' />}
                  maxDisplay={2}
                />
              )}

              {hasPriorBadges && hasOrigin && (
                <span className='inline-flex align-middle mx-1 h-4 w-px bg-border' />
              )}

              {hasOrigin && <TaskOriginBadge task={task} className='ms-1' />}

              {(hasPriorBadges || hasOrigin) && isSnoozedIntoFuture && (
                <span className='inline-flex align-middle mx-1 h-4 w-px bg-border' />
              )}

              {isSnoozedIntoFuture && (
                <Badge variant='amber' size='sm' className='ms-1 align-middle'>
                  <AlarmClock />
                  Snoozed until {formatTaskDeadlineDisplay(new Date(task.snoozedUntil as Date))}
                </Badge>
              )}
            </div>
          </div>

          {/* Deadline */}
          {task.deadline && (
            <div className='flex-shrink-0 text-xs text-muted-foreground'>
              {formatTaskDeadline(new Date(task.deadline))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
