// apps/web/src/components/tasks/ui/create-task-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { Plus } from 'lucide-react'
import { useCreateTaskStore } from '../stores/create-task-store'

interface CreateTaskButtonProps {
  variant?: 'default' | 'outline'
}

/**
 * Button that opens the global task creation dialog
 */
export function CreateTaskButton({ variant = 'default' }: CreateTaskButtonProps) {
  const openDialog = useCreateTaskStore((s) => s.openDialog)

  return (
    <Button variant={variant} size='sm' onClick={() => openDialog()}>
      <Plus />
      Create Task{' '}
      <KbdGroup variant='default'>
        <Kbd>t</Kbd>
        <Kbd>n</Kbd>
      </KbdGroup>
    </Button>
  )
}
