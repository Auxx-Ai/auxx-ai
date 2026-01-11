// apps/web/src/components/tasks/stores/task-store.ts

'use client'

import '~/lib/immer-config' // Enables Map/Set support for immer
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import type { TaskWithRelations } from '@auxx/lib/tasks'

/**
 * Task store state interface
 */
interface TaskStoreState {
  /** Task cache: id → task data */
  tasks: Map<string, TaskWithRelations>

  /** Set multiple tasks (from list fetch) */
  setTasks: (tasks: TaskWithRelations[]) => void

  /** Update a single task (from mutation or optimistic update) */
  updateTask: (task: Partial<TaskWithRelations> & { id: string }) => void

  /** Remove a task (after deletion) */
  removeTask: (taskId: string) => void

  /** Invalidate a single task */
  invalidateTask: (taskId: string) => void

  /** Clear all cached tasks */
  clearAll: () => void
}

/**
 * Zustand store for task data caching.
 * Uses immer for immutable updates with structural sharing.
 */
export const useTaskStore = create<TaskStoreState>()(
  subscribeWithSelector(
    immer((set) => ({
      tasks: new Map(),

      setTasks: (tasks) => {
        set((state) => {
          for (const task of tasks) {
            state.tasks.set(task.id, task)
          }
        })
      },

      updateTask: (task) => {
        set((state) => {
          const existing = state.tasks.get(task.id)
          if (existing) {
            Object.assign(existing, task)
          }
        })
      },

      removeTask: (taskId) => {
        set((state) => {
          state.tasks.delete(taskId)
        })
      },

      invalidateTask: (taskId) => {
        set((state) => {
          state.tasks.delete(taskId)
        })
      },

      clearAll: () => {
        set((state) => {
          state.tasks.clear()
        })
      },
    }))
  )
)
