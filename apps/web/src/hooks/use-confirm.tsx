// ~/hooks/use-confirm.tsx
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
import { useState } from 'react'

interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

type ConfirmCallback = (value: boolean) => void

/**
 * Hook for creating confirmation dialogs before performing destructive actions
 */
export function useConfirm() {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions>({})
  const [callback, setCallback] = useState<ConfirmCallback | null>(null)

  const confirm = (options: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise((resolve) => {
      setOptions({
        title: options.title || 'Confirm',
        description: options.description || 'Are you sure?',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        destructive: options.destructive || false,
      })

      setCallback(() => resolve)
      setOpen(true)
    })
  }

  const handleConfirm = () => {
    setOpen(false)
    callback?.(true)
    setCallback(null)
  }

  const handleCancel = () => {
    setOpen(false)
    callback?.(false)
    setCallback(null)
  }

  const ConfirmDialog = () => (
    <Dialog open={open} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle data-testid='confirmation-modal-title'>{options.title}</DialogTitle>
          {options.description && (
            <DialogDescription data-testid='confirmation-modal-description'>
              {options.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className='gap-2 sm:gap-0 pt-2 sm:pt-0'>
          <Button
            size='sm'
            variant='ghost'
            onClick={handleCancel}
            data-testid='confirmation-modal-cancel-button'>
            {options.cancelText} <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            size='sm'
            variant={options.destructive ? 'destructive' : 'outline'}
            onClick={handleConfirm}
            data-testid='confirmation-modal-confirm-button'>
            {options.confirmText} <KbdSubmit variant='default' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return [confirm, ConfirmDialog] as const
}
