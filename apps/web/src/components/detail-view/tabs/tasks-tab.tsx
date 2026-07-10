// apps/web/src/components/detail-view/tabs/tasks-tab.tsx
'use client'

import { TasksSection } from '~/components/tasks/ui/tasks-section'
import type { DetailViewTabProps } from '../types'

/**
 * TasksTab - wrapper for the TasksSection component
 * Used in detail view main tabs area
 */
export function TasksTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  return <TasksSection recordId={recordId} variant={variant} />
}

export default TasksTab
