// apps/web/src/components/tasks/hooks/use-task-effective-state.ts

import { useTaskStore } from '../stores/task-store'

/**
 * Get the effective completion state for a task.
 * Returns pending optimistic state if exists, otherwise stored state.
 */
export function useTaskEffectiveCompletedAt(taskId: string): string | null {
  return useTaskStore((s) => {
    const pending = s.pendingCompletions.get(taskId)
    if (pending) return pending.completedAt
    const task = s.tasks.get(taskId)
    return task?.completedAt ?? null
  })
}

/**
 * Check if a task has a pending completion change.
 * Useful for showing visual feedback (e.g., pending indicator).
 */
export function useTaskHasPendingCompletion(taskId: string): boolean {
  return useTaskStore((s) => s.pendingCompletions.has(taskId))
}
