// apps/web/src/components/records/global-record-editor-root.tsx

'use client'

import { RecordEditorDialog } from './record-editor-dialog'
import { useRecordEditorStore } from './record-editor-store'

/**
 * Root-level renderer for the global "edit an existing record" dialog.
 * Mount once at the app layout level (alongside `GlobalCreateRoot`) so any
 * surface — relationship badges, hover cards, pickers — can open a record
 * editor without rendering the dialog inside its own (popover) subtree.
 *
 * See {@link useRecordEditorStore} for why root-level rendering matters.
 */
export function GlobalRecordEditorRoot() {
  const open = useRecordEditorStore((s) => s.open)
  const entityDefinitionId = useRecordEditorStore((s) => s.entityDefinitionId)
  const recordId = useRecordEditorStore((s) => s.recordId)
  const close = useRecordEditorStore((s) => s.close)

  if (!open || !entityDefinitionId || !recordId) return null

  return (
    <RecordEditorDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) close()
      }}
      entityDefinitionId={entityDefinitionId}
      recordId={recordId}
    />
  )
}
