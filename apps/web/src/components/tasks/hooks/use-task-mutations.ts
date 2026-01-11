// apps/web/src/components/tasks/hooks/use-task-mutations.ts

import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useTaskStore } from '../stores/task-store'

/**
 * Hook providing mutation functions for task operations.
 * Includes optimistic updates and cache invalidation.
 */
export function useTaskMutations() {
  const utils = api.useUtils()
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

  // Update task
  const updateTask = api.task.update.useMutation({
    onSuccess: (task) => {
      updateTaskInStore(task)
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to update task', description: error.message })
    },
  })

  // Complete task
  const completeTask = api.task.complete.useMutation({
    onMutate: async ({ taskId }) => {
      // Optimistic update
      updateTaskInStore({
        id: taskId,
        completedAt: new Date().toISOString(),
      } as any)
    },
    onSuccess: (task) => {
      updateTaskInStore(task)
      utils.task.list.invalidate()
    },
    onError: (error, { taskId }) => {
      // Rollback optimistic update
      updateTaskInStore({ id: taskId, completedAt: null } as any)
      toastError({ title: 'Failed to complete task', description: error.message })
    },
  })

  // Reopen task (uncomplete)
  const reopenTask = api.task.reopen.useMutation({
    onMutate: async ({ taskId }) => {
      // Optimistic update
      updateTaskInStore({ id: taskId, completedAt: null } as any)
    },
    onSuccess: (task) => {
      updateTaskInStore(task)
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to reopen task', description: error.message })
    },
  })

  // Archive task
  const archiveTask = api.task.archive.useMutation({
    onSuccess: (task) => {
      updateTaskInStore(task)
      utils.task.list.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to archive task', description: error.message })
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

  return {
    createTask,
    updateTask,
    completeTask,
    reopenTask,
    archiveTask,
    deleteTask,
    isCreating: createTask.isPending,
    isUpdating: updateTask.isPending,
    isCompleting: completeTask.isPending || reopenTask.isPending,
    isArchiving: archiveTask.isPending,
    isDeleting: deleteTask.isPending,
  }
}
