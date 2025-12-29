// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/store.ts
import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import type { SchemaRoot, StructuredSchema } from '../types'
import { VisualEditorContext } from './context'

type VisualEditorStore = {
  hoveringProperty: string | null
  setHoveringProperty: (propertyPath: string | null) => void
  isAddingNewField: boolean
  setIsAddingNewField: (isAdding: boolean) => void
  advancedEditing: boolean
  setAdvancedEditing: (isEditing: boolean) => void
  // Support both old and new schema formats during migration
  backupSchema: SchemaRoot | StructuredSchema | null
  setBackupSchema: (schema: SchemaRoot | StructuredSchema | null) => void
  structuredBackupSchema: StructuredSchema | null
  setStructuredBackupSchema: (schema: StructuredSchema | null) => void
  isActivelyEditing: boolean
  setIsActivelyEditing: (isEditing: boolean) => void
  focusedFieldPath: string | null
  setFocusedFieldPath: (path: string | null) => void
}

let storeInstance: ReturnType<typeof createStore<VisualEditorStore>> | null = null

export const createVisualEditorStore = () => {
  const store = createStore<VisualEditorStore>((set) => ({
    hoveringProperty: null,
    setHoveringProperty: (propertyPath: string | null) => set({ hoveringProperty: propertyPath }),
    isAddingNewField: false,
    setIsAddingNewField: (isAdding: boolean) => set({ isAddingNewField: isAdding }),
    advancedEditing: false,
    setAdvancedEditing: (isEditing: boolean) => set({ advancedEditing: isEditing }),
    backupSchema: null,
    setBackupSchema: (schema: SchemaRoot | StructuredSchema | null) =>
      set({ backupSchema: schema }),
    structuredBackupSchema: null,
    setStructuredBackupSchema: (schema: StructuredSchema | null) =>
      set({ structuredBackupSchema: schema }),
    isActivelyEditing: false,
    setIsActivelyEditing: (isEditing: boolean) => set({ isActivelyEditing: isEditing }),
    focusedFieldPath: null,
    setFocusedFieldPath: (path: string | null) => set({ focusedFieldPath: path }),
  }))
  storeInstance = store
  return store
}

export const getVisualEditorStore = () => storeInstance

export const useVisualEditorStore = <T>(selector: (state: VisualEditorStore) => T): T => {
  const store = useContext(VisualEditorContext)
  if (!store) throw new Error('Missing VisualEditorContext.Provider in the tree')

  return useStore(store, selector)
}
