// apps/web/src/components/tasks/utils/group-tasks.ts

import {
  isToday,
  isTomorrow,
  isThisWeek,
  isPast,
  isYesterday,
  isThisMonth,
  startOfWeek,
  endOfWeek,
  subWeeks,
} from 'date-fns'
import type { TaskWithRelations } from '@auxx/lib/tasks'
import type { TaskSortField, SortDirection } from '@auxx/lib/tasks/client'

/**
 * Variant for group header styling
 */
export type TaskGroupVariant = 'danger' | 'warning' | 'default' | 'muted' | 'success'

/**
 * Task group structure for UI rendering (period-level grouping)
 */
export interface TaskGroup {
  id: string
  title: string
  variant: TaskGroupVariant
  tasks: TaskWithRelations[]
  /** Optional metadata (e.g., user image for assignee groups) */
  meta?: {
    userImage?: string | null
    userId?: string | null
  }
}

/**
 * Top-level completion group (uncompleted vs completed)
 * Similar to Timeline's yearGroup structure
 */
export interface TaskCompletionGroup {
  id: 'uncompleted' | 'completed'
  title: string
  /** Whether to show the section header (false for uncompleted, true for completed) */
  showHeader: boolean
  /** Period groups within this completion section */
  periods: TaskGroup[]
}

/**
 * Group tasks based on the current sort field.
 * Returns an array of groups with consistent structure.
 * @deprecated Use groupTasksByCompletion for two-level grouping
 */
export function groupTasks(
  tasks: TaskWithRelations[],
  sortField: TaskSortField,
  sortDirection: SortDirection
): TaskGroup[] {
  switch (sortField) {
    case 'deadline':
      return groupByDeadline(tasks, sortDirection)
    case 'assignee':
      return groupByAssignee(tasks, sortDirection)
    case 'createdAt':
      return groupByDate(tasks, 'createdAt', sortDirection)
    case 'completedAt':
      return groupByDate(tasks, 'completedAt', sortDirection)
    case 'priority':
      return groupByPriority(tasks, sortDirection)
    case 'title':
      // No grouping for alphabetical sort
      return [{ id: 'all', title: 'All Tasks', variant: 'default', tasks }]
    default:
      return [{ id: 'all', title: 'All Tasks', variant: 'default', tasks }]
  }
}

/**
 * Group tasks by completion status first, then by periods.
 * Returns two-level structure: completion groups → period groups.
 * Uncompleted section has no header, completed section shows "Completed" header.
 */
export function groupTasksByCompletion(
  tasks: TaskWithRelations[],
  sortField: TaskSortField,
  sortDirection: SortDirection
): TaskCompletionGroup[] {
  // Separate completed and uncompleted tasks
  const uncompleted = tasks.filter((t) => !t.completedAt)
  const completed = tasks.filter((t) => t.completedAt)

  const result: TaskCompletionGroup[] = []

  // Group uncompleted tasks by the sort field (excluding completed from deadline grouping)
  if (uncompleted.length > 0) {
    const uncompletedPeriods = groupUncompletedTasks(uncompleted, sortField, sortDirection)
    result.push({
      id: 'uncompleted',
      title: '',
      showHeader: false,
      periods: uncompletedPeriods,
    })
  }

  // Group completed tasks by completedAt date
  if (completed.length > 0) {
    const completedPeriods = groupCompletedTasks(completed, sortDirection)
    result.push({
      id: 'completed',
      title: 'Completed',
      showHeader: true,
      periods: completedPeriods,
    })
  }

  return result
}

/**
 * Group uncompleted tasks based on sort field.
 */
function groupUncompletedTasks(
  tasks: TaskWithRelations[],
  sortField: TaskSortField,
  sortDirection: SortDirection
): TaskGroup[] {
  switch (sortField) {
    case 'deadline':
      return groupUncompletedByDeadline(tasks, sortDirection)
    case 'assignee':
      return groupByAssignee(tasks, sortDirection)
    case 'createdAt':
      return groupByDate(tasks, 'createdAt', sortDirection)
    case 'priority':
      return groupByPriority(tasks, sortDirection)
    case 'title':
      return [{ id: 'all', title: 'All Tasks', variant: 'default', tasks }]
    default:
      return [{ id: 'all', title: 'All Tasks', variant: 'default', tasks }]
  }
}

/**
 * Group uncompleted tasks by deadline period (no completed group).
 */
function groupUncompletedByDeadline(
  tasks: TaskWithRelations[],
  direction: SortDirection
): TaskGroup[] {
  const groups: Record<string, TaskWithRelations[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    'this-week': [],
    upcoming: [],
    'no-date': [],
  }

  for (const task of tasks) {
    if (!task.deadline) {
      groups['no-date'].push(task)
      continue
    }

    const deadline = new Date(task.deadline)

    if (isPast(deadline) && !isToday(deadline)) {
      groups.overdue.push(task)
    } else if (isToday(deadline)) {
      groups.today.push(task)
    } else if (isTomorrow(deadline)) {
      groups.tomorrow.push(task)
    } else if (isThisWeek(deadline, { weekStartsOn: 1 })) {
      groups['this-week'].push(task)
    } else {
      groups.upcoming.push(task)
    }
  }

  const periodConfig: Array<{ id: string; title: string; variant: TaskGroupVariant }> = [
    { id: 'overdue', title: 'Overdue', variant: 'danger' },
    { id: 'today', title: 'Today', variant: 'warning' },
    { id: 'tomorrow', title: 'Tomorrow', variant: 'default' },
    { id: 'this-week', title: 'This Week', variant: 'default' },
    { id: 'upcoming', title: 'Upcoming', variant: 'muted' },
    { id: 'no-date', title: 'No Due Date', variant: 'muted' },
  ]

  const orderedConfig = direction === 'desc' ? [...periodConfig].reverse() : periodConfig

  return orderedConfig
    .filter(({ id }) => groups[id].length > 0)
    .map(({ id, title, variant }) => ({
      id,
      title,
      variant,
      tasks: groups[id],
    }))
}

/**
 * Group completed tasks by completedAt date.
 */
function groupCompletedTasks(tasks: TaskWithRelations[], direction: SortDirection): TaskGroup[] {
  const groups: Record<string, TaskWithRelations[]> = {
    today: [],
    yesterday: [],
    'this-week': [],
    'last-week': [],
    'this-month': [],
    older: [],
  }

  for (const task of tasks) {
    if (!task.completedAt) {
      groups.older.push(task)
      continue
    }

    const date = new Date(task.completedAt)

    if (isToday(date)) {
      groups.today.push(task)
    } else if (isYesterday(date)) {
      groups.yesterday.push(task)
    } else if (isThisWeek(date, { weekStartsOn: 1 })) {
      groups['this-week'].push(task)
    } else if (isLastWeek(date)) {
      groups['last-week'].push(task)
    } else if (isThisMonth(date)) {
      groups['this-month'].push(task)
    } else {
      groups.older.push(task)
    }
  }

  const periodConfig: Array<{ id: string; title: string }> = [
    { id: 'today', title: 'Today' },
    { id: 'yesterday', title: 'Yesterday' },
    { id: 'this-week', title: 'This Week' },
    { id: 'last-week', title: 'Last Week' },
    { id: 'this-month', title: 'This Month' },
    { id: 'older', title: 'Older' },
  ]

  const orderedConfig = direction === 'desc' ? periodConfig : [...periodConfig].reverse()

  return orderedConfig
    .filter(({ id }) => groups[id].length > 0)
    .map(({ id, title }) => ({
      id: `completed-${id}`,
      title,
      variant: 'success' as const,
      tasks: groups[id],
    }))
}

/**
 * Group tasks by deadline period.
 */
function groupByDeadline(tasks: TaskWithRelations[], direction: SortDirection): TaskGroup[] {
  const groups: Record<string, TaskWithRelations[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    'this-week': [],
    upcoming: [],
    'no-date': [],
    completed: [],
  }

  for (const task of tasks) {
    if (task.completedAt) {
      groups.completed.push(task)
      continue
    }

    if (!task.deadline) {
      groups['no-date'].push(task)
      continue
    }

    const deadline = new Date(task.deadline)

    if (isPast(deadline) && !isToday(deadline)) {
      groups.overdue.push(task)
    } else if (isToday(deadline)) {
      groups.today.push(task)
    } else if (isTomorrow(deadline)) {
      groups.tomorrow.push(task)
    } else if (isThisWeek(deadline, { weekStartsOn: 1 })) {
      groups['this-week'].push(task)
    } else {
      groups.upcoming.push(task)
    }
  }

  const periodConfig: Array<{ id: string; title: string; variant: TaskGroupVariant }> = [
    { id: 'overdue', title: 'Overdue', variant: 'danger' },
    { id: 'today', title: 'Today', variant: 'warning' },
    { id: 'tomorrow', title: 'Tomorrow', variant: 'default' },
    { id: 'this-week', title: 'This Week', variant: 'default' },
    { id: 'upcoming', title: 'Upcoming', variant: 'muted' },
    { id: 'no-date', title: 'No Due Date', variant: 'muted' },
    { id: 'completed', title: 'Completed', variant: 'success' },
  ]

  // Reverse order for desc direction
  const orderedConfig = direction === 'desc' ? [...periodConfig].reverse() : periodConfig

  return orderedConfig
    .filter(({ id }) => groups[id].length > 0)
    .map(({ id, title, variant }) => ({
      id,
      title,
      variant,
      tasks: groups[id],
    }))
}

/**
 * Group tasks by assignee.
 */
function groupByAssignee(tasks: TaskWithRelations[], direction: SortDirection): TaskGroup[] {
  const grouped = new Map<string | null, TaskWithRelations[]>()

  for (const task of tasks) {
    const firstAssignee = task.assignments[0]?.assignedTo ?? null
    const key = firstAssignee?.id ?? null

    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(task)
  }

  const entries = Array.from(grouped.entries())

  // Sort groups alphabetically, with unassigned at end
  entries.sort(([aKey, aTasks], [bKey, bTasks]) => {
    if (aKey === null) return direction === 'asc' ? 1 : -1
    if (bKey === null) return direction === 'asc' ? -1 : 1

    const aName = aTasks[0]?.assignments.find((a) => a.assignedTo.id === aKey)?.assignedTo.name ?? ''
    const bName = bTasks[0]?.assignments.find((a) => a.assignedTo.id === bKey)?.assignedTo.name ?? ''

    const cmp = aName.localeCompare(bName)
    return direction === 'asc' ? cmp : -cmp
  })

  return entries.map(([userId, groupTasks]) => {
    const user = groupTasks[0]?.assignments.find((a) => a.assignedTo.id === userId)?.assignedTo
    return {
      id: userId ?? 'unassigned',
      title: user?.name ?? user?.email ?? 'Unassigned',
      variant: 'default' as const,
      tasks: groupTasks,
      meta: {
        userImage: user?.image ?? null,
        userId,
      },
    }
  })
}

/**
 * Group tasks by a date field (createdAt or completedAt).
 */
function groupByDate(
  tasks: TaskWithRelations[],
  field: 'createdAt' | 'completedAt',
  direction: SortDirection
): TaskGroup[] {
  const groups: Record<string, TaskWithRelations[]> = {
    today: [],
    yesterday: [],
    'this-week': [],
    'last-week': [],
    'this-month': [],
    older: [],
  }

  for (const task of tasks) {
    const dateStr = task[field]
    if (!dateStr) {
      groups.older.push(task)
      continue
    }

    const date = new Date(dateStr)

    if (isToday(date)) {
      groups.today.push(task)
    } else if (isYesterday(date)) {
      groups.yesterday.push(task)
    } else if (isThisWeek(date, { weekStartsOn: 1 })) {
      groups['this-week'].push(task)
    } else if (isLastWeek(date)) {
      groups['last-week'].push(task)
    } else if (isThisMonth(date)) {
      groups['this-month'].push(task)
    } else {
      groups.older.push(task)
    }
  }

  const periodConfig: Array<{ id: string; title: string }> = [
    { id: 'today', title: 'Today' },
    { id: 'yesterday', title: 'Yesterday' },
    { id: 'this-week', title: 'This Week' },
    { id: 'last-week', title: 'Last Week' },
    { id: 'this-month', title: 'This Month' },
    { id: 'older', title: 'Older' },
  ]

  const orderedConfig = direction === 'desc' ? periodConfig : [...periodConfig].reverse()

  return orderedConfig
    .filter(({ id }) => groups[id].length > 0)
    .map(({ id, title }) => ({
      id,
      title,
      variant: 'default' as const,
      tasks: groups[id],
    }))
}

/**
 * Group tasks by priority.
 */
function groupByPriority(tasks: TaskWithRelations[], direction: SortDirection): TaskGroup[] {
  const groups: Record<string, TaskWithRelations[]> = {
    high: [],
    medium: [],
    low: [],
    none: [],
  }

  for (const task of tasks) {
    const priority = task.priority ?? 'none'
    if (priority === 'high' || priority === 'medium' || priority === 'low') {
      groups[priority].push(task)
    } else {
      groups.none.push(task)
    }
  }

  const priorityConfig: Array<{ id: string; title: string; variant: TaskGroupVariant }> = [
    { id: 'high', title: 'High Priority', variant: 'danger' },
    { id: 'medium', title: 'Medium Priority', variant: 'warning' },
    { id: 'low', title: 'Low Priority', variant: 'default' },
    { id: 'none', title: 'No Priority', variant: 'muted' },
  ]

  // Reverse for asc direction (low first)
  const orderedConfig = direction === 'asc' ? [...priorityConfig].reverse() : priorityConfig

  return orderedConfig
    .filter(({ id }) => groups[id].length > 0)
    .map(({ id, title, variant }) => ({
      id,
      title,
      variant,
      tasks: groups[id],
    }))
}

/**
 * Check if a date is in last week.
 */
function isLastWeek(date: Date): boolean {
  const now = new Date()
  const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })
  const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })
  return date >= lastWeekStart && date <= lastWeekEnd
}
