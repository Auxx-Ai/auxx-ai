// apps/web/src/components/manufacturing/builds/backflush-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { BackflushPanel } from './backflush-panel'

interface BackflushDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** {@link BackflushPanel} in a dialog, with the confirm in the footer. */
export function BackflushDialog({ open, onOpenChange }: BackflushDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='md'>
        <DialogHeader>
          <DialogTitle>Record past builds</DialogTitle>
          <DialogDescription>
            For every day a made part ended below zero, record one completed build for the
            shortfall, dated that day, so its parts are used up on the right days.
          </DialogDescription>
        </DialogHeader>

        <BackflushPanel
          enabled={open}
          actions={({ runId, canConfirm, isStarting, confirm }) => (
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={isStarting}>
                {runId ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              {!runId && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!canConfirm}
                  loading={isStarting}
                  loadingText='Starting...'
                  onClick={() => void confirm()}
                  data-dialog-submit>
                  Record past builds <KbdSubmit variant='outline' size='sm' />
                </Button>
              )}
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
