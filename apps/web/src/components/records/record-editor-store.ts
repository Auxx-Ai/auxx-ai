// apps/web/src/components/records/record-editor-store.ts

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { create } from 'zustand'

interface RecordEditorStoreState {
  open: boolean
  entityDefinitionId: string | null
  recordId: RecordId | null

  /** Open the edit dialog for an existing record. */
  openEditor: (args: { entityDefinitionId: string; recordId: RecordId }) => void
  close: () => void
}

/**
 * Global store for the "edit an existing record" dialog.
 *
 * The dialog is rendered once at the app root ({@link GlobalRecordEditorRoot})
 * rather than inline wherever the edit is triggered. Triggers are usually deep
 * inside a relationship picker / hover card, and Radix registers a locally
 * rendered dialog as a *branch* of that enclosing popover — so opening it never
 * dismisses the popover and it sits open behind the dialog. Rendering at the
 * root keeps the dialog out of every popover's branch, so the popover's own
 * `onFocusOutside` fires when the modal takes focus and it closes normally.
 *
 * Mirrors the create-side {@link useCreateEntityStore}.
 */
export const useRecordEditorStore = create<RecordEditorStoreState>((set) => ({
  open: false,
  entityDefinitionId: null,
  recordId: null,

  openEditor: ({ entityDefinitionId, recordId }) => {
    set({ open: true, entityDefinitionId, recordId })
  },

  close: () => {
    set({ open: false, entityDefinitionId: null, recordId: null })
  },
}))
