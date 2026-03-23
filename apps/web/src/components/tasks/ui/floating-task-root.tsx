// apps/web/src/components/tasks/ui/floating-task-root.tsx

'use client'

import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { useCreateTaskStore } from '../stores/create-task-store'
import { TaskDialog } from './task-dialog'

/**
 * Root-level renderer for the global task creation dialog.
 * Mount once at the app layout level so tasks can be created from anywhere.
 */
export function FloatingTaskRoot() {
  const open = useCreateTaskStore((s) => s.open)
  const defaultReferencedEntity = useCreateTaskStore((s) => s.defaultReferencedEntity)
  const closeDialog = useCreateTaskStore((s) => s.closeDialog)

  // Global shortcut: T,N to open task creation dialog
  useHotkeySequence(
    ['T', 'N'],
    () => {
      useCreateTaskStore.getState().openDialog()
    },
    { timeout: 500 }
  )

  return (
    <TaskDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeDialog()
      }}
      mode='create'
      defaultReferencedEntity={defaultReferencedEntity}
    />
  )
}
