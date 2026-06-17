// apps/web/src/components/kbar/pages/create-task.tsx
'use client'

import { TaskForm } from '~/components/tasks/ui/task-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link TaskForm} as a palette page (create mode). The
 * breadcrumb supplies the title; the Esc carve-out for the @mention picker lives
 * in the palette shell (see `command-palette.tsx`). On save the palette closes
 * (or, with "Create more", the form resets and stays); cancel / back returns to
 * root.
 */
export function CreateTaskPage() {
  const page = useCommandPaletteStore((s) => s.page)
  const ref = useCommandPaletteStore((s) => s.createTaskRef)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <TaskForm
      open={page === 'create-task'}
      mode='create'
      defaultReferencedEntity={ref ?? undefined}
      onClose={close}
      onCancel={() => goTo('root')}
    />
  )
}
