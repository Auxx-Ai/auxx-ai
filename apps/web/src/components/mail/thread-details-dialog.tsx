// apps/web/src/components/mail/thread-details-dialog.tsx
'use client'

import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import ThreadDetails from './thread-details'
import { NestedThreadProvider, ThreadProvider } from './thread-provider'

interface ThreadDetailsDialogProps {
  threadId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog wrapper around ThreadDetails. Mounts ThreadProvider internally and
 * marks the subtree as nested so global behaviors (R/F hotkeys, reply-portal
 * id) don't collide with another ThreadDetails mounted in the same page.
 */
export function ThreadDetailsDialog({ threadId, open, onOpenChange }: ThreadDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position='tc'
        size='xxl'
        innerClassName='p-0 max-h-[80vh] overflow-auto overscroll-none'>
        {threadId && (
          <NestedThreadProvider value={true}>
            <ThreadProvider threadId={threadId}>
              <ThreadDetails
                portalIdPrefix='dialog-'
                className='**:data-[slot=thread-header-actions]:mr-4'
              />
            </ThreadProvider>
          </NestedThreadProvider>
        )}
      </DialogContent>
    </Dialog>
  )
}
