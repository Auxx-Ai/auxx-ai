// apps/web/src/components/tasks/ui/tasks-list.tsx

'use client'

import { useState, useMemo, useCallback } from 'react'
import { ListTodo } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { EmptyState } from '~/components/global/empty-state'
import { TasksListHeader } from './tasks-list-header'
import { TaskItem } from './task-item'
import { TaskDialog } from './task-dialog'
import { useTasks } from '../hooks/use-tasks'
import { groupTasksByCompletion } from '../utils/group-tasks'
import { convertConditionsToFilterProps } from '../utils/condition-to-props'
import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { TaskSortConfig } from '@auxx/lib/tasks/client'
import type { TaskViewMode } from '@auxx/types/task'
import type { Condition } from '~/components/conditions'
import type { ResourceId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for TasksList component
 */
interface TasksListProps {
  /** View mode - 'entity' for drawer, 'global' for full page */
  viewMode?: TaskViewMode
  /** Filter tasks to those linked to this resource (required for 'entity' mode) */
  resourceId?: ResourceId
  /** Filter conditions from TaskFilterBar */
  filters?: Condition[]
  /** Sort configuration */
  sort?: TaskSortConfig
  /** Include completed tasks (can be overridden by filters) */
  includeCompleted?: boolean
  /** Callback when create button is clicked (from empty state) */
  onCreateClick?: () => void
  /** Show entity reference badges on task items (useful in global mode) */
  showEntityReferences?: boolean
  className?: string
}

/** Default sort config */
const DEFAULT_SORT: TaskSortConfig = { field: 'deadline', direction: 'asc' }

/**
 * TasksList renders a grouped list of tasks with period headers.
 * Supports both entity-scoped (drawer) and global (page) modes.
 *
 * In entity mode: Shows tasks linked to a specific entity instance.
 * In global mode: Shows all tasks with entity reference badges.
 */
export function TasksList({
  viewMode = 'entity',
  resourceId,
  filters,
  sort = DEFAULT_SORT,
  includeCompleted = true,
  onCreateClick,
  showEntityReferences = false,
  className,
}: TasksListProps) {
  // Convert Condition[] to individual filter props
  const filterProps = useMemo(() => convertConditionsToFilterProps(filters ?? []), [filters])

  // Fetch tasks with optional resource filter
  const { tasks, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useTasks({
    resourceId: viewMode === 'entity' ? resourceId : undefined,
    assigneeIds: filterProps.assigneeIds,
    priority: filterProps.priority,
    search: filterProps.search,
    includeCompleted: filterProps.includeCompleted ?? includeCompleted,
  })

  // Track collapsed state for each group
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Selected task for edit dialog
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null)

  // Group tasks by completion status, then by sort field periods
  const groupedData = useMemo(
    () => groupTasksByCompletion(tasks, sort.field, sort.direction),
    [tasks, sort.field, sort.direction]
  )

  /**
   * Toggle collapse state for a group
   */
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  /**
   * Handle task item click - open edit dialog
   */
  const handleTaskClick = useCallback((task: TaskWithRelations) => {
    setSelectedTask(task)
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <EmptyState
        icon={ListTodo}
        iconClassName="animate-spin"
        title="Loading tasks"
        description="Fetching tasks..."
        button={<Button size="sm" className="invisible pointer-events-none"></Button>}
      />
    )
  }

  // Empty state
  if (tasks.length === 0) {
    const emptyMessage =
      viewMode === 'entity'
        ? 'Create a task to track work related to this record'
        : 'Create a task to get started'

    return (
      <EmptyState
        icon={ListTodo}
        className="py-8"
        title="No tasks yet"
        description={emptyMessage}
        button={
          onCreateClick ? (
            <Button variant="outline" size="sm" onClick={onCreateClick}>
              Create task
            </Button>
          ) : (
            <Button size="sm" className="invisible pointer-events-none"></Button>
          )
        }
      />
    )
  }

  return (
    <>
      <div className={cn('tasks-list relative w-full', className)}>
        {groupedData.map((completionGroup) => (
          <div key={completionGroup.id}>
            {/* Completion Section Header (only shown for completed) */}
            {completionGroup.showHeader && (
              <div className="text-sm font-medium text-primary-400 mt-6 mb-2">
                {completionGroup.title}
              </div>
            )}

            {/* Period Groups */}
            {completionGroup.periods.map((period) => {
              const isCollapsed = collapsedGroups.has(period.id)

              return (
                <div key={period.id} className="mb-4">
                  {/* Period Header */}
                  <TasksListHeader
                    title={period.title}
                    count={period.tasks.length}
                    variant={period.variant}
                    meta={period.meta}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleGroup(period.id)}
                  />

                  {/* Task Items */}
                  {!isCollapsed && (
                    <div className="space-y-1 mt-2">
                      {period.tasks.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onClick={() => handleTaskClick(task)}
                          showEntityReferences={showEntityReferences || viewMode === 'global'}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {/* Load More */}
        {hasNextPage && (
          <div className="flex justify-center py-4">
            <Button
              onClick={fetchNextPage}
              variant="ghost"
              size="sm"
              loading={isFetchingNextPage}
              loadingText="Loading...">
              Load more
            </Button>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <TaskDialog
        open={!!selectedTask}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        mode="edit"
        task={selectedTask ?? undefined}
      />
    </>
  )
}
