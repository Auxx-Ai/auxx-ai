// apps/web/src/lib/extensions/use-message-client.ts
'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'
import type { MessageClient } from './message-client'

/**
 * Hook to access the MessageClient for a specific extension.
 * Suspends until the MessageClient is available.
 */
export function useMessageClient({
  appId,
  appInstallationId,
}: {
  appId: string
  appInstallationId: string
}): MessageClient {
  const { store } = useInternalAppsContext()

  // Subscribe to message client changes
  const subscribe = useCallback(
    (callback: () => void) => {
      return store.events.messageClientChanged.addListener((event) => {
        if (event.appId === appId && event.appInstallationId === appInstallationId) {
          callback()
        }
      })
    },
    [appId, appInstallationId, store]
  )

  // Get snapshot of current message client
  const getSnapshot = useCallback(() => {
    return store.getMessageClient({ appId, appInstallationId })
  }, [appId, appInstallationId, store])

  const messageClient = useSyncExternalStore(subscribe, getSnapshot, () => null)

  // Suspend until message client is available
  if (!messageClient) {
    throw new Promise<void>((resolve) => {
      const unsubscribe = store.events.messageClientChanged.addListener((event) => {
        if (event.appId === appId && event.appInstallationId === appInstallationId) {
          unsubscribe()
          resolve()
        }
      })
    })
  }

  return messageClient
}
