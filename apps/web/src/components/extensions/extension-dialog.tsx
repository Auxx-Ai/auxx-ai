// apps/web/src/components/extensions/extension-dialog.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { useEffect, useReducer } from 'react'
import { useDialog } from '~/lib/extensions/use-dialog'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Global extension dialog renderer.
 * Automatically shows when an extension opens a dialog via showDialog().
 *
 * This component listens to the AppStore for dialog state changes
 * and renders the dialog with the extension's content.
 *
 * Also subscribes to dialog updates to re-render when React state changes
 * in the dialog component (e.g., countdown timers, form inputs).
 */
export function ExtensionDialog() {
  const { dialog, isOpen } = useDialog()
  const { store } = useInternalAppsContext()
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  // Subscribe to dialog updates to handle React state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: using dialog?.id for granular subscription instead of full dialog object
  useEffect(() => {
    if (!dialog) return

    const unsubscribe = store.events.dialogUpdated.addListener(({ dialogId }) => {
      if (dialogId === dialog.id) {
        console.log('[ExtensionDialog] Dialog updated, re-rendering:', dialogId)
        forceUpdate()
      }
    })

    return unsubscribe
  }, [dialog?.id, store])

  if (!isOpen || !dialog) {
    return null
  }

  // Get dialog attributes from the dialog object (not component props)
  const title = dialog.title || 'Extension Dialog'
  const size = dialog.size || 'medium'

  // Map size to Tailwind classes
  const sizeClasses = {
    small: 'max-w-md',
    medium: 'max-w-2xl',
    large: 'max-w-4xl',
    fullscreen: 'max-w-[95vw] h-[95vh]',
  }

  /**
   * Handle dialog close.
   * Close the dialog in the AppStore and notify iframe to clean up.
   * This ensures both close paths (UI close and button close) work correctly.
   */
  const handleClose = () => {
    console.log('[ExtensionDialog] Closing dialog:', dialog.id)

    // Close dialog in AppStore immediately
    store.closeDialog(dialog.id)

    // Get the MessageClient for this dialog's app
    const messageClient = store.getMessageClient({
      appId: dialog.appId,
      appInstallationId: dialog.appInstallationId,
    })

    // Notify iframe to clean up its internal state
    if (messageClient) {
      console.log('[ExtensionDialog] Notifying iframe: dialog-close-requested')
      messageClient.sendMessage('dialog-close-requested', { id: dialog.id })
    } else {
      console.warn('[ExtensionDialog] MessageClient not found, dialog closed in store only')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={sizeClasses[size as keyof typeof sizeClasses]} position='tc'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className='py-4'>
          {/* Render the reconstructed React tree */}
          {dialog.component}
        </div>
      </DialogContent>
    </Dialog>
  )
}
