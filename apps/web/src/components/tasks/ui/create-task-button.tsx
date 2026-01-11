// apps/web/src/components/tasks/ui/create-task-button.tsx

'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { TaskDialog } from './task-dialog'

interface CreateTaskButtonProps {
  variant?: 'default' | 'outline'
}

/**
 * Button that opens the task creation dialog
 */
export function CreateTaskButton({ variant = 'default' }: CreateTaskButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Plus />
        Create Task
      </Button>
      <TaskDialog open={open} onOpenChange={setOpen} mode="create" />
    </>
  )
}
