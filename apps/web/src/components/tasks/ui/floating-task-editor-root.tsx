// apps/web/src/components/tasks/ui/floating-task-editor-root.tsx
'use client'

import { useTask } from '../hooks/use-task'
import { useTaskEditorStore } from '../stores/task-editor-store'
import { TaskDialog } from './task-dialog'

/** Root-level renderer for editing an existing task from global surfaces. */
export function FloatingTaskEditorRoot() {
  const open = useTaskEditorStore((state) => state.open)
  const taskId = useTaskEditorStore((state) => state.taskId)
  const close = useTaskEditorStore((state) => state.close)
  const { task } = useTask({ taskId: taskId ?? '', enabled: open && !!taskId })

  if (!open || !taskId || !task) return null

  return (
    <TaskDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) close()
      }}
      mode='edit'
      task={task}
    />
  )
}
