// apps/web/src/components/tasks/ui/task-item.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge'
import { TaskCheckbox } from './task-checkbox'
import { useTaskCompletion } from '../hooks/use-task-completion'
import {
  useTaskEffectiveCompletedAt,
  useTaskHasPendingCompletion,
} from '../hooks/use-task-effective-state'
import { formatTaskDeadline } from '../utils/group-tasks-by-period'
import type { TaskWithRelations } from '@auxx/lib/tasks'

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
      <div className="flex-1 min-w-0" onClick={onClick}>
        <div className="flex items-start justify-between gap-2">
          {/* Title and Metadata */}
          <div className="flex-1 min-w-0">
            <div
              className={cn(
                'text-sm text-primary-600 dark:text-primary-400',
                isCompleted && 'line-through'
              )}>
              {task.title}
            </div>

            {/* Entity References (shown in global mode) */}
            {showEntityReferences && task.references && task.references.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {task.references.slice(0, 3).map((ref) => (
                  <Badge
                    key={ref.id}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    style={{
                      borderColor: ref.entityDefinition?.color ?? undefined,
                      color: ref.entityDefinition?.color ?? undefined,
                    }}>
                    {ref.entityDefinition?.name}: {ref.entityInstance?.displayName || 'Unnamed'}
                  </Badge>
                ))}
                {task.references.length > 3 && (
                  <Badge variant="outline" size="sm" className="text-xs">
                    +{task.references.length - 3} more
                  </Badge>
                )}
              </div>
            )}

            {/* Assignees (shown when there are assignees) */}
            {task.assignments && task.assignments.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {task.assignments.slice(0, 2).map((assignment) => (
                  <Badge key={assignment.id} variant="secondary" size="sm">
                    {assignment.assignedTo?.name || assignment.assignedTo?.email}
                  </Badge>
                ))}
                {task.assignments.length > 2 && (
                  <Badge variant="secondary" size="sm">
                    +{task.assignments.length - 2}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Deadline */}
          {task.deadline && (
            <div className="flex-shrink-0 text-xs text-muted-foreground">
              {formatTaskDeadline(new Date(task.deadline))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
