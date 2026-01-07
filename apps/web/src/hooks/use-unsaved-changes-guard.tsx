// apps/web/src/hooks/use-unsaved-changes-guard.tsx
'use client'

import { useCallback, useRef } from 'react'
import { useConfirm } from '~/hooks/use-confirm'

/**
 * Options for the unsaved changes guard
 */
interface UseUnsavedChangesGuardOptions {
  /** Whether there are unsaved changes to protect */
  isDirty: boolean
  /** Called when close is confirmed (user discards changes or no changes exist) */
  onConfirmedClose: () => void
  /** Custom confirmation dialog options */
  confirmOptions?: {
    title?: string
    description?: string
    confirmText?: string
    cancelText?: string
  }
}

/**
 * Return type for the unsaved changes guard hook
 */
interface UseUnsavedChangesGuardReturn {
  /** Spread these props onto DialogContent to intercept close events */
  guardProps: {
    onEscapeKeyDown: (event: KeyboardEvent) => void
    onInteractOutside: (event: Event) => void
  }
  /** Use this for Cancel buttons and custom close actions */
  guardedClose: () => Promise<void>
  /** Render this component to show the confirmation dialog */
  ConfirmDialog: React.FC
}

/**
 * Hook to guard a dialog against accidental close when there are unsaved changes.
 *
 * @example
 * ```tsx
 * const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
 *   isDirty,
 *   onConfirmedClose: () => onOpenChange(false),
 * })
 *
 * return (
 *   <>
 *     <Dialog open={open} onOpenChange={onOpenChange}>
 *       <DialogContent {...guardProps}>
 *         <Button onClick={guardedClose}>Cancel</Button>
 *       </DialogContent>
 *     </Dialog>
 *     <ConfirmDialog />
 *   </>
 * )
 * ```
 */
export function useUnsavedChangesGuard({
  isDirty,
  onConfirmedClose,
  confirmOptions = {},
}: UseUnsavedChangesGuardOptions): UseUnsavedChangesGuardReturn {
  const [confirm, ConfirmDialog] = useConfirm()

  // Prevent multiple simultaneous confirmation dialogs
  const isConfirmingRef = useRef(false)

  const {
    title = 'Discard changes?',
    description = 'Are you sure you want to discard your unsaved changes?',
    confirmText = 'Discard',
    cancelText = 'Keep editing',
  } = confirmOptions

  /**
   * Show confirmation if dirty, otherwise close immediately
   */
  const guardedClose = useCallback(async () => {
    // Prevent multiple calls while confirming
    if (isConfirmingRef.current) return

    if (isDirty) {
      isConfirmingRef.current = true
      try {
        const confirmed = await confirm({
          title,
          description,
          confirmText,
          cancelText,
          destructive: true,
        })
        if (confirmed) {
          onConfirmedClose()
        }
      } finally {
        isConfirmingRef.current = false
      }
    } else {
      onConfirmedClose()
    }
  }, [isDirty, confirm, title, description, confirmText, cancelText, onConfirmedClose])

  /**
   * Handle ESC key - prevent close and show confirmation if dirty
   */
  const handleEscapeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isDirty) {
        event.preventDefault()
        guardedClose()
      }
    },
    [isDirty, guardedClose]
  )

  /**
   * Handle click outside - prevent close and show confirmation if dirty
   * Ignores clicks on toast notifications
   */
  const handleInteractOutside = useCallback(
    (event: Event) => {
      // Ignore clicks on toast notifications
      if (event.target instanceof HTMLElement && event.target.closest('[data-toast-container]')) {
        return
      }
      if (isDirty) {
        event.preventDefault()
        guardedClose()
      }
    },
    [isDirty, guardedClose]
  )

  return {
    guardProps: {
      onEscapeKeyDown: handleEscapeKeyDown,
      onInteractOutside: handleInteractOutside,
    },
    guardedClose,
    ConfirmDialog,
  }
}
