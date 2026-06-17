// apps/web/src/components/mail-views/mail-view-dialog.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { MailViewForm } from './mail-view-form'

interface MailViewDialogProps {
  isOpen: boolean
  onClose: () => void
  mailViewId?: string // If provided, we're editing an existing view
}

/**
 * Thin modal wrapper around {@link MailViewForm}. Supplies the `Dialog` shell and
 * the header; all form logic lives in the core, which the command palette hosts
 * directly as a page. Public API is unchanged.
 */
export function MailViewDialog({ isOpen, onClose, mailViewId }: MailViewDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='xl' variant='default' position='tc'>
        <MailViewForm
          open={isOpen}
          mailViewId={mailViewId}
          onClose={onClose}
          header={({ title }) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
