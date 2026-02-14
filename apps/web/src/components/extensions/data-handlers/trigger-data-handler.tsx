// apps/web/src/components/extensions/data-handlers/trigger-data-handler.tsx
'use client'

import { useEffect } from 'react'
import { useExtensionDataHandlerContext } from '~/providers/extensions/extension-data-handler-context'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Listens for surface trigger completion/errors from extension.
 * Handles the 'surface-trigger-complete' and 'surface-trigger-error' messages.
 */
export function TriggerDataHandler() {
  const { appId, appInstallationId, isDevLoggingEnabled, messageClient } =
    useExtensionDataHandlerContext()
  const { store } = useInternalAppsContext()

  useEffect(() => {
    // Listen for trigger completion
    const unsubscribeComplete = messageClient.listenForRequest(
      'surface-trigger-complete',
      ({ triggerId, result }) => {
        if (typeof triggerId !== 'number') {
          console.error(`[TriggerDataHandler] Invalid triggerId from App(${appId}):`, triggerId)
          return null
        }

        // Complete trigger in AppStore
        store.completeTrigger({ triggerId, result })

        // Dev logging
        if (isDevLoggingEnabled) {
          console.log(`[TriggerDataHandler] App(${appId}) completed trigger #${triggerId}`)
        }

        return null
      }
    )

    // Listen for trigger errors
    const unsubscribeError = messageClient.listenForRequest(
      'surface-trigger-error',
      ({ triggerId, error }) => {
        if (typeof triggerId !== 'number') {
          console.error(`[TriggerDataHandler] Invalid triggerId from App(${appId}):`, triggerId)
          return null
        }

        // Fail trigger in AppStore
        store.failTrigger({ triggerId, error: error || 'Unknown error' })

        // Dev logging
        if (isDevLoggingEnabled) {
          console.error(`[TriggerDataHandler] App(${appId}) failed trigger #${triggerId}:`, error)
        }

        return null
      }
    )

    return () => {
      unsubscribeComplete()
      unsubscribeError()
    }
  }, [appId, isDevLoggingEnabled, messageClient, store])

  return null
}
