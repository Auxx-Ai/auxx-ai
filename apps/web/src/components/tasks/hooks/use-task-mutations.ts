// apps/web/src/components/tasks/hooks/use-task-mutations.ts

import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useTaskStore } from '../stores/task-store'
import { useSession } from '~/auth/auth-client'

/**
 * Hook providing mutation functions for task operations.
 * Uses a single `update` mutation for all field changes.
 */
export function useTaskMutations() {
  const utils = api.useUtils()
  const { data: session } = useSession()
  const userId = session?.user?.id

  const updateTaskInStore = useTaskStore((s) => s.updateTask)
  const removeTaskFromStore = useTaskStore((s) => s.removeTask)

  // Create task
  const createTask = api.task.create.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to create task', description: error.message })
    },
  })

  // Update task (handles ALL updates: fields, completion, archiving)
  const updateTask = api.task.update.useMutation({
    onSuccess: (task) => {
      updateTaskInStore(task)
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update task', description: error.message })
    },
  })

  // Delete task (permanent)
  const deleteTask = api.task.delete.useMutation({
    onSuccess: (_, { taskId }) => {
      removeTaskFromStore(taskId)
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete task', description: error.message })
    },
  })

  // ─────────────────────────────────────────────────────────────────
  // CONVENIENCE WRAPPERS (use the unified update mutation)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Mark a task as complete
   */
  const completeTask = (taskId: string) => {
    return updateTask.mutateAsync({
      id: taskId,
      completedAt: new Date().toISOString(),
      completedById: userId,
    })
  }

  /**
   * Reopen a completed task
   */
  const reopenTask = (taskId: string) => {
    return updateTask.mutateAsync({
      id: taskId,
      completedAt: null,
      completedById: null,
    })
  }

  /**
   * Archive a task
   */
  const archiveTask = (taskId: string) => {
    return updateTask.mutateAsync({
      id: taskId,
      archivedAt: new Date().toISOString(),
    })
  }

  /**
   * Unarchive a task
   */
  const unarchiveTask = (taskId: string) => {
    return updateTask.mutateAsync({
      id: taskId,
      archivedAt: null,
    })
  }

  return {
    // Core mutations
    createTask,
    updateTask,
    deleteTask,

    // Convenience wrappers
    completeTask,
    reopenTask,
    archiveTask,
    unarchiveTask,

    // Loading states
    isCreating: createTask.isPending,
    isUpdating: updateTask.isPending,
    isDeleting: deleteTask.isPending,
  }
}
