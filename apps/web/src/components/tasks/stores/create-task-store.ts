// apps/web/src/components/tasks/stores/create-task-store.ts

'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
import { create } from 'zustand'

interface CreateTaskStoreState {
  open: boolean
  defaultReferencedEntity?: RecordId

  openDialog: (defaults?: { referencedEntity?: RecordId }) => void
  closeDialog: () => void
}

export const useCreateTaskStore = create<CreateTaskStoreState>((set) => ({
  open: false,
  defaultReferencedEntity: undefined,

  openDialog: (defaults) => {
    set({ open: true, defaultReferencedEntity: defaults?.referencedEntity })
  },

  closeDialog: () => {
    set({ open: false, defaultReferencedEntity: undefined })
  },
}))
