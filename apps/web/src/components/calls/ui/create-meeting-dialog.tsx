// apps/web/src/components/calls/ui/create-meeting-dialog.tsx
'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { MeetingForm } from './meeting-form'

interface CreateMeetingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Thin modal wrapper around {@link MeetingForm}. Supplies the `Dialog` shell and the
 * header; all form logic lives in the core, which the command palette hosts directly
 * as a page. Public API is unchanged.
 */
export function CreateMeetingDialog({ open, onOpenChange }: CreateMeetingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <MeetingForm
          open={open}
          onClose={() => onOpenChange(false)}
          header={({ title }) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                Schedule a new meeting and optionally generate a video link.
              </DialogDescription>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
