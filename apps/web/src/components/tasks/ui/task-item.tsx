// apps/web/src/components/tasks/ui/task-item.tsx

'use client'

import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { ActorId } from '@auxx/types/actor'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ParsedText } from '~/components/editor/parsed-text'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ItemsListView } from '~/components/ui/items-list-view'
import { useTaskCompletion } from '../hooks/use-task-completion'
import {
  useTaskEffectiveCompletedAt,
  useTaskHasPendingCompletion,
} from '../hooks/use-task-effective-state'
import { formatTaskDeadline } from '../utils/group-tasks-by-period'
import { TaskCheckbox } from './task-checkbox'

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
                'text-sm text-primary-600 dark:text-primary-400',
                isCompleted && 'line-through'
              )}>
              <ParsedText>{task.title}</ParsedText>
            </div>
            <div className='flex flex-wrap gap-2 mt-1 items-center'>
              {/* Entity References (shown in global mode) */}
              {hasReferences && (
                <ItemsListView
                  className='w-auto'
                  items={task.references}
                  renderItem={(recordId) => (
                    <RecordBadge recordId={recordId as string} showIcon variant='default' />
                  )}
                  maxDisplay={3}
                />
              )}

              {/* Assignees (shown when there are assignees) */}
              {hasAssignments && hasReferences ? (
                <Separator orientation='vertical' className='h-4' />
              ) : null}
              {hasAssignments ? (
                <ItemsListView
                  className='w-auto'
                  items={task.assignments}
                  renderItem={(actorId) => <ActorBadge actorId={actorId as ActorId} />}
                  maxDisplay={2}
                />
              ) : null}
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
