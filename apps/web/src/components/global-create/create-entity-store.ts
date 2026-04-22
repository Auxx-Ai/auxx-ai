// apps/web/src/components/global-create/create-entity-store.ts

'use client'

import { create } from 'zustand'

interface CreateEntityStoreState {
  open: boolean
  entityDefinitionId: string | null

  openDialog: (args: { entityDefinitionId: string }) => void
  closeDialog: () => void
}

export const useCreateEntityStore = create<CreateEntityStoreState>((set) => ({
  open: false,
  entityDefinitionId: null,

  openDialog: ({ entityDefinitionId }) => {
    set({ open: true, entityDefinitionId })
  },

  closeDialog: () => {
    set({ open: false, entityDefinitionId: null })
  },
}))
