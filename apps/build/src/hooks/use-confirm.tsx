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
        <DialogHeader className='mb-0'>
          <DialogTitle>{options.title}</DialogTitle>
          {options.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className='gap-2 sm:gap-0'>
          <Button size='sm' variant='ghost' onClick={handleCancel}>
            {options.cancelText}
          </Button>
          <Button
            size='sm'
            variant={options.destructive ? 'destructive' : 'default'}
            onClick={handleConfirm}>
            {options.confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return [confirm, ConfirmDialog] as const
}
