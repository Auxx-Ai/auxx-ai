// apps/web/src/components/inbox/inbox-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { InboxForm } from './inbox-form'

/** Props for InboxDialog */
interface InboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode, null/undefined for create mode */
  recordId?: RecordId | null
  /** Called after successful save */
  onSuccess?: (inbox: { id: string; name: string; recordId: RecordId }) => void
}

/**
 * Thin modal wrapper around {@link InboxForm}. Supplies the `Dialog` shell and the
 * header; all form logic (pickers, access radio, unsaved-changes guard, delete)
 * lives in the core, which the command palette hosts directly as a page. Public API
 * is unchanged.
 */
export function InboxDialog({ open, onOpenChange, recordId, onSuccess }: InboxDialogProps) {
  const isEditing = !!recordId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <InboxForm
          open={open}
          recordId={recordId}
          onSuccess={onSuccess}
          onClose={() => onOpenChange(false)}
          header={({ title }) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {isEditing
                  ? 'Update inbox settings.'
                  : 'Create a new inbox to organize your messages.'}
              </DialogDescription>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
