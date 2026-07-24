// apps/web/src/components/tasks/stores/task-editor-store.ts
'use client'

import { create } from 'zustand'

interface TaskEditorStoreState {
  open: boolean
  taskId: string | null
  openEditor: (taskId: string) => void
  close: () => void
}

/** Global state for opening an existing task from any application surface. */
export const useTaskEditorStore = create<TaskEditorStoreState>((set) => ({
  open: false,
  taskId: null,
  openEditor: (taskId) => set({ open: true, taskId }),
  close: () => set({ open: false, taskId: null }),
}))
