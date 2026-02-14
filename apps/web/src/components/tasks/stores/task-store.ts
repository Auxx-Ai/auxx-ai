// apps/web/src/components/tasks/stores/task-store.ts

'use client'

import '~/lib/immer-config' // Enables Map/Set support for immer
import type { TaskWithRelations } from '@auxx/lib/tasks'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

/** Delay before list reorders after completion toggle (ms) */
export const LIST_UPDATE_DELAY_MS = 2000

/**
 * Pending completion state for optimistic updates
 */
interface PendingCompletion {
  /** New completion state (Date ISO string or null) */
  completedAt: string | null
  /** Original completion state for rollback */
  originalCompletedAt: string | null
  /** Timestamp when the change was initiated */
  timestamp: number
  /** Version for race condition handling */
  version: number
}

/**
 * Task store state interface
 */
interface TaskStoreState {
  /** Task cache: id → task data */
  tasks: Map<string, TaskWithRelations>

  /** Optimistic completion tracking: taskId → pending state */
  pendingCompletions: Map<string, PendingCompletion>

  /** Single global timer for debounced batch updates */
  globalUpdateTimer: NodeJS.Timeout | null

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

  /**
   * Set optimistic completion state for a task.
   * Returns the version number for race condition handling.
   */
  setOptimisticCompletion: (taskId: string, completedAt: string | null) => number

  /**
   * Confirm a pending completion (on mutation success).
   * Only applies if version matches to handle race conditions.
   */
  confirmCompletion: (taskId: string, version: number) => void

  /**
   * Rollback a pending completion (on mutation error).
   * Only applies if version matches to handle race conditions.
   */
  rollbackCompletion: (taskId: string, version: number) => void

  /**
   * Get the effective completion state for a task.
   * Returns pending optimistic state if exists, otherwise stored state.
   */
  getEffectiveCompletedAt: (taskId: string) => string | null | undefined

  /**
   * Check if a task has a pending completion change.
   */
  hasPendingCompletion: (taskId: string) => boolean

  /**
   * Schedule a global update after a delay.
   * Resets the timer on each call - batches all pending updates together.
   */
  scheduleGlobalUpdate: (callback: () => void, delayMs: number) => void

  /**
   * Cancel the global update timer.
   */
  cancelGlobalUpdate: () => void

  /**
   * Clear pending completion state for a task.
   * Called on error to rollback a single task.
   */
  clearPendingCompletion: (taskId: string) => void

  /**
   * Clear all pending completion states.
   * Called after batch update to finalize all optimistic updates.
   */
  clearAllPendingCompletions: () => void
}

/**
 * Zustand store for task data caching with optimistic completion support.
 * Uses immer for immutable updates with structural sharing.
 */
export const useTaskStore = create<TaskStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      tasks: new Map(),
      pendingCompletions: new Map(),
      globalUpdateTimer: null,

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
          state.pendingCompletions.delete(taskId)
        })
      },

      invalidateTask: (taskId) => {
        set((state) => {
          state.tasks.delete(taskId)
        })
      },

      clearAll: () => {
        const state = get()
        if (state.globalUpdateTimer) {
          clearTimeout(state.globalUpdateTimer)
        }
        set((s) => {
          s.tasks.clear()
          s.pendingCompletions.clear()
          s.globalUpdateTimer = null
        })
      },

      setOptimisticCompletion: (taskId, completedAt) => {
        const state = get()
        const task = state.tasks.get(taskId)
        const existing = state.pendingCompletions.get(taskId)
        const version = (existing?.version ?? 0) + 1

        set((s) => {
          s.pendingCompletions.set(taskId, {
            completedAt,
            originalCompletedAt: task?.completedAt ?? null,
            timestamp: Date.now(),
            version,
          })
        })

        return version
      },

      confirmCompletion: (taskId, version) => {
        const state = get()
        const pending = state.pendingCompletions.get(taskId)

        // Only confirm if version matches (handles race conditions)
        if (!pending || pending.version !== version) return

        // Update the store's task, but DON'T clear pendingCompletions yet.
        // It will be cleared by setTasks when fresh query data arrives.
        // This prevents the UI from flashing back to stale query data.
        set((s) => {
          const task = s.tasks.get(taskId)
          if (task) {
            task.completedAt = pending.completedAt
          }
        })
      },

      rollbackCompletion: (taskId, version) => {
        const state = get()
        const pending = state.pendingCompletions.get(taskId)

        // Only rollback if version matches
        if (!pending || pending.version !== version) return

        set((s) => {
          s.pendingCompletions.delete(taskId)
        })
      },

      getEffectiveCompletedAt: (taskId) => {
        const state = get()
        const pending = state.pendingCompletions.get(taskId)
        if (pending) return pending.completedAt
        return state.tasks.get(taskId)?.completedAt ?? undefined
      },

      hasPendingCompletion: (taskId) => {
        return get().pendingCompletions.has(taskId)
      },

      scheduleGlobalUpdate: (callback, delayMs) => {
        const state = get()

        // Clear existing global timer
        if (state.globalUpdateTimer) {
          clearTimeout(state.globalUpdateTimer)
        }

        // Schedule new timer - resets on each call
        const timer = setTimeout(() => {
          callback()
          set((s) => {
            s.globalUpdateTimer = null
          })
        }, delayMs)

        set((s) => {
          s.globalUpdateTimer = timer
        })
      },

      cancelGlobalUpdate: () => {
        const state = get()
        if (state.globalUpdateTimer) {
          clearTimeout(state.globalUpdateTimer)
          set((s) => {
            s.globalUpdateTimer = null
          })
        }
      },

      clearPendingCompletion: (taskId) => {
        set((s) => {
          s.pendingCompletions.delete(taskId)
        })
      },

      clearAllPendingCompletions: () => {
        set((s) => {
          s.pendingCompletions.clear()
        })
      },
    }))
  )
)
