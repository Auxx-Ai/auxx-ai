// apps/web/src/lib/extensions/use-dialog.ts
'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Hook to get the currently open dialog (if any).
 *
 * This hook subscribes to dialog open/close events and automatically
 * re-renders when the dialog state changes.
 *
 * @returns Dialog state and control functions
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { dialog, isOpen, closeDialog } = useDialog()
 *
 *   if (!isOpen) return null
 *
 *   return <Dialog open={isOpen} onOpenChange={() => closeDialog()}>
 *     {dialog.component}
 *   </Dialog>
 * }
 * ```
 */
export function useDialog() {
  const { store } = useInternalAppsContext()

  // Subscribe to dialog events
  const subscribe = useCallback(
    (callback: () => void) => {
      const unsubscribeOpened = store.events.dialogOpened.addListener(callback)
      const unsubscribeClosed = store.events.dialogClosed.addListener(callback)

      return () => {
        unsubscribeOpened()
        unsubscribeClosed()
      }
    },
    [store]
  )

  // Get current dialog snapshot
  const getSnapshot = useCallback(() => {
    return store.getOpenDialog()
  }, [store])

  const dialog = useSyncExternalStore(subscribe, getSnapshot, () => null)

  // Close dialog function
  const closeDialog = useCallback(() => {
    if (dialog) {
      store.closeDialog(dialog.id)
    }
  }, [store, dialog])

  return {
    /** The currently open dialog (null if no dialog is open) */
    dialog,
    /** Whether a dialog is currently open */
    isOpen: dialog !== null,
    /** Function to close the currently open dialog */
    closeDialog,
  }
}
