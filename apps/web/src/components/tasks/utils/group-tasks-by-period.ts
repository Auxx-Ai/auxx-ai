// apps/web/src/components/tasks/utils/group-tasks-by-period.ts

import { differenceInDays, format, isToday, isTomorrow } from 'date-fns'

/**
 * Format deadline for task item display.
 * Returns relative labels like "Today", "Tomorrow", or absolute date.
 */
export function formatTaskDeadline(deadline: Date): string {
  if (isToday(deadline)) {
    return 'Today'
  }
  if (isTomorrow(deadline)) {
    return 'Tomorrow'
  }

  const daysUntil = differenceInDays(deadline, new Date())

  if (daysUntil < 0) {
    const daysOverdue = Math.abs(daysUntil)
    return daysOverdue === 1 ? '1 day overdue' : `${daysOverdue} days overdue`
  }

  if (daysUntil <= 7) {
    return format(deadline, 'EEEE') // Day name
  }

  return format(deadline, 'MMM d') // "Jan 15"
}

/**
 * Format deadline for dialog footer button display.
 * Returns shorter format suitable for button text.
 */
export function formatTaskDeadlineDisplay(deadline: Date): string {
  if (isToday(deadline)) {
    return 'Today'
  }
  if (isTomorrow(deadline)) {
    return 'Tomorrow'
  }

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (
    deadline.getDate() === yesterday.getDate() &&
    deadline.getMonth() === yesterday.getMonth() &&
    deadline.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday'
  }

  return format(deadline, 'MMM d')
}
