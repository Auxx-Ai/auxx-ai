// apps/web/src/components/tasks/hooks/use-task-completion.ts

import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useTaskStore, LIST_UPDATE_DELAY_MS } from '../stores/task-store'
import { useSession } from '~/auth/auth-client'
import type { TaskWithRelations } from '@auxx/lib/tasks'

/**
 * Hook for optimistic task completion with delayed list updates.
 * Allows users to toggle completion multiple times before list reorders.
 */
export function useTaskCompletion() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const userId = session?.user?.id

  // Store actions - extracted individually to avoid re-render issues
  const setOptimisticCompletion = useTaskStore((s) => s.setOptimisticCompletion)
  const confirmCompletion = useTaskStore((s) => s.confirmCompletion)
  const rollbackCompletion = useTaskStore((s) => s.rollbackCompletion)
  const scheduleGlobalUpdate = useTaskStore((s) => s.scheduleGlobalUpdate)
  const clearAllPendingCompletions = useTaskStore((s) => s.clearAllPendingCompletions)

  // Track in-flight mutations to prevent duplicates
  const mutationVersionsRef = useRef<Map<string, number>>(new Map())

  // Use unified update mutation for both complete and reopen
  const updateTask = api.task.update.useMutation({
    onSuccess: (task) => {
      const version = mutationVersionsRef.current.get(task.id)
      if (version !== undefined) {
        confirmCompletion(task.id, version)
        mutationVersionsRef.current.delete(task.id)

        // Schedule/reset global timer - applies ALL pending on inactivity
        scheduleGlobalUpdate(() => {
          // Get all pending completions at callback time
          const pendingCompletions = useTaskStore.getState().pendingCompletions

          // Update all task.list query caches for ALL pending tasks at once
          queryClient.setQueriesData<{
            tasks: TaskWithRelations[]
            total: number
            hasMore: boolean
          }>(
            { queryKey: [['task', 'list']] },
            (oldData) => {
              if (!oldData?.tasks) return oldData
              return {
                ...oldData,
                tasks: oldData.tasks.map((t) => {
                  const pending = pendingCompletions.get(t.id)
                  if (pending) {
                    return { ...t, completedAt: pending.completedAt }
                  }
                  return t
                }),
              }
            }
          )

          // Clear all pending states after cache is updated
          clearAllPendingCompletions()
        }, LIST_UPDATE_DELAY_MS)
      }
    },
    onError: (error, variables) => {
      const taskId = variables.id
      const version = mutationVersionsRef.current.get(taskId)
      if (version !== undefined) {
        rollbackCompletion(taskId, version)
        mutationVersionsRef.current.delete(taskId)
      }
      toastError({ title: 'Failed to update task', description: error.message })
    },
  })

  /**
   * Toggle task completion with optimistic UI.
   * Checkbox updates immediately, list reorders after inactivity delay.
   */
  const toggleCompletion = useCallback(
    (taskId: string, currentlyCompleted: boolean) => {
      // Set optimistic state and get version
      const completedAt = currentlyCompleted ? null : new Date().toISOString()
      const version = setOptimisticCompletion(taskId, completedAt)
      mutationVersionsRef.current.set(taskId, version)

      // Fire mutation - use unified update
      if (currentlyCompleted) {
        // Reopen
        updateTask.mutate({
          id: taskId,
          completedAt: null,
          completedById: null,
        })
      } else {
        // Complete
        updateTask.mutate({
          id: taskId,
          completedAt: new Date().toISOString(),
          completedById: userId,
        })
      }
    },
    [setOptimisticCompletion, updateTask, userId]
  )

  return {
    toggleCompletion,
    isPending: updateTask.isPending,
  }
}
