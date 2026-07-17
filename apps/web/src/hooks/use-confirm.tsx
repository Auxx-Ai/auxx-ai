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
import { useCallback, useState } from 'react'

interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** Optional third choice between Cancel and Confirm (e.g. "Skip this and future visits") —
   * resolves the promise with `'alternate'`. Both truthy results mean the user proceeded;
   * callers that never pass this keep the plain boolean contract. */
  alternateText?: string
  destructive?: boolean
}

/** `true` = primary confirm, `'alternate'` = the optional third button, `false` = canceled. */
export type ConfirmResult = boolean | 'alternate'

type ConfirmCallback = (value: ConfirmResult) => void

/**
 * Hook for creating confirmation dialogs before performing destructive actions
 */
export function useConfirm() {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions>({})
  const [callback, setCallback] = useState<ConfirmCallback | null>(null)

  // Stable identity across renders — the closure only captures useState setters,
  // which React guarantees stable. Consumers (e.g. useEntityInstanceOperations)
  // put `confirm` in callback dep arrays; an unstable identity there cascades
  // into the records-table column defs (primaryCellRender) and re-renders the
  // whole grid on unrelated updates.
  const confirm = useCallback((options: ConfirmOptions = {}): Promise<ConfirmResult> => {
    return new Promise((resolve) => {
      setOptions({
        title: options.title || 'Confirm',
        description: options.description || 'Are you sure?',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        alternateText: options.alternateText,
        destructive: options.destructive || false,
      })

      setCallback(() => resolve)
      setOpen(true)
    })
  }, [])

  const resolveWith = (value: ConfirmResult) => {
    setOpen(false)
    callback?.(value)
    setCallback(null)
  }

  const handleConfirm = () => resolveWith(true)
  const handleCancel = () => resolveWith(false)

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
          {options.alternateText && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => resolveWith('alternate')}
              data-testid='confirmation-modal-alternate-button'>
              {options.alternateText}
            </Button>
          )}
          <Button
            data-dialog-submit
            size='sm'
            variant={options.destructive ? 'destructive' : 'outline'}
            onClick={handleConfirm}
            data-testid='confirmation-modal-confirm-button'>
            {options.confirmText}{' '}
            <KbdSubmit variant={options.destructive ? 'default' : 'outline'} size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return [confirm, ConfirmDialog] as const
}
