// apps/web/src/components/extensions/data-handlers/dialog-data-handler.tsx
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useEffect } from 'react'
import { reconstructReactTree } from '~/lib/extensions/reconstruct-react-tree'
import { useExtensionDataHandlerContext } from '~/providers/extensions/extension-data-handler-context'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Handles dialog-related messages from extension runtime.
 *
 * 1. Listen for 'dialog-opened' (extension notifies platform)
 * 2. Request component render via 'render-component'
 * 3. Reconstruct sanitized tree
 * 4. Display dialog
 * 5. Handle close requests
 */
export function DialogDataHandler() {
  const { store } = useInternalAppsContext()
  const { appId, appInstallationId, messageClient, isDevLoggingEnabled } =
    useExtensionDataHandlerContext()

  useEffect(() => {
    if (!messageClient) return

    // Listen for component updates (React state changes)
    const unsubscribeUpdates = messageClient.listenForRequest(
      'component-updated',
      async (data: any) => {
        const { id, component } = data

        if (isDevLoggingEnabled) {
          console.log(`[DialogDataHandler] App(${appId}) dialog updated:`, id)
        }

        try {
          // Reconstruct the updated tree
          const reconstructed = reconstructReactTree(component, {
            injectedProps: {
              hideDialog: () => {
                console.log(`[DialogDataHandler] hideDialog called for:`, id)
                messageClient.sendMessage('close-dialog', { id })
              },
            },
            onCallHandler: async (instanceId: number, eventName: string, ...args: any[]) => {
              console.log(
                `[DialogDataHandler] Calling event:`,
                eventName,
                'on instance:',
                instanceId,
                'with args:',
                args
              )
              const result = await messageClient.sendRequest('call-instance-method', {
                instanceId,
                eventName,
                args,
              })
              return result
            },
          })

          // Update dialog in store
          store.updateDialog({
            dialogId: id,
            component: reconstructed,
          })

          if (isDevLoggingEnabled) {
            console.log(`[DialogDataHandler] App(${appId}) dialog updated successfully:`, id)
          }
        } catch (error: any) {
          console.error('[DialogDataHandler] Failed to update dialog:', error)
        }

        return null
      }
    )

    // Listen for dialog opened notification
    const unsubscribeOpened = messageClient.listenForRequest('dialog-opened', async (data: any) => {
      const { id, title, size } = data

      if (isDevLoggingEnabled) {
        console.log(`[DialogDataHandler] App(${appId}) opened dialog:`, id)
      }

      try {
        // Request component render from runtime
        console.log(`[DialogDataHandler] Requesting render for dialog:`, id)
        const result = await messageClient.sendRequest('render-component', { id })

        if ('error' in result) {
          throw new Error(result.error.message || 'Failed to render dialog')
        }

        if (!result.success || !result.component) {
          throw new Error('Invalid render response')
        }

        // Reconstruct the sanitized tree
        console.log(`[DialogDataHandler] Reconstructing dialog tree`)
        const reconstructed = reconstructReactTree(result.component, {
          injectedProps: {
            // Inject hideDialog function
            hideDialog: () => {
              console.log(`[DialogDataHandler] hideDialog called for:`, id)
              // Send close message to runtime
              messageClient.sendMessage('close-dialog', { id })
            },
          },
          onCallHandler: async (instanceId: number, eventName: string, ...args: any[]) => {
            console.log(
              `[DialogDataHandler] Calling event:`,
              eventName,
              'on instance:',
              instanceId,
              'with args:',
              args
            )
            const result = await messageClient.sendRequest('call-instance-method', {
              instanceId,
              eventName,
              args,
            })
            return result
          },
        })

        // Open dialog in store
        console.log(`[DialogDataHandler] Opening dialog in store`)
        store.openDialog({
          appId,
          appInstallationId,
          dialogId: id,
          title,
          size,
          component: reconstructed,
        })

        if (isDevLoggingEnabled) {
          console.log(`[DialogDataHandler] App(${appId}) dialog opened successfully:`, id)
        }
      } catch (error: any) {
        console.error('[DialogDataHandler] Failed to open dialog:', error)
        toastError({
          title: 'Extension error',
          description: 'Failed to open dialog. Please try again.',
        })
      }

      return null
    })

    // Listen for close dialog request (from hideDialog in iframe)
    const unsubscribeClose = messageClient.listenForRequest('close-dialog', async (data: any) => {
      const { id } = data

      if (isDevLoggingEnabled) {
        console.log(`[DialogDataHandler] App(${appId}) requested close:`, id)
      }

      // Close the dialog
      store.closeDialog(id)

      // Notify runtime that dialog is closed
      console.log(`[DialogDataHandler] Notifying runtime: dialog-close-requested`)
      messageClient.sendMessage('dialog-close-requested', { id })

      return null
    })

    return () => {
      unsubscribeUpdates()
      unsubscribeOpened()
      unsubscribeClose()
    }
  }, [messageClient, store, appId, appInstallationId, isDevLoggingEnabled])

  return null
}
