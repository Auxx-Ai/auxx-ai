// apps/web/src/components/tasks/ui/task-dialog.tsx

'use client'

import type { RecordId } from '@auxx/lib/field-values/client'
import type { TaskWithRelations } from '@auxx/lib/tasks'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { preventTaskPickerEscape, TaskForm } from './task-form'

/**
 * Props for TaskDialog component
 */
interface TaskDialogProps {
  /** Whether dialog is open */
  open: boolean
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void
  /** Create or edit mode */
  mode: 'create' | 'edit'
  /** Task to edit (required for edit mode) */
  task?: TaskWithRelations
  /** Default entity reference when creating from entity drawer */
  defaultReferencedEntity?: RecordId
}

/**
 * Thin modal wrapper around {@link TaskForm}. Supplies the `Dialog` shell, the
 * header, and the Esc carve-out that keeps the @mention picker's Esc from closing
 * the dialog. All form logic lives in the core, which the command palette hosts
 * directly as a page. Public API is unchanged.
 */
export function TaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  defaultReferencedEntity,
}: TaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position='tc'
        size='xl'
        innerClassName='p-0'
        onEscapeKeyDown={preventTaskPickerEscape}>
        <TaskForm
          open={open}
          mode={mode}
          task={task}
          defaultReferencedEntity={defaultReferencedEntity}
          onClose={() => onOpenChange(false)}
          header={({ title }) => (
            <DialogHeader className='border-b px-3 py-2 mb-0 h-10 '>
              <DialogTitle className='text-base font-medium'>{title}</DialogTitle>
              <DialogDescription className='sr-only'>Template selector</DialogDescription>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
