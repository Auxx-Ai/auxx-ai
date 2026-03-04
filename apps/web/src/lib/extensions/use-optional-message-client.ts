// apps/web/src/lib/extensions/use-optional-message-client.ts

'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MessageClient } from './message-client'
import { useAppStore } from './use-app-store'

/**
 * Non-suspending hook to access a MessageClient for an extension.
 * Returns `undefined` while the client is initializing, and surfaces
 * bundle-load errors from `renderErrored` so callers can distinguish
 * "still loading" from "failed to load".
 */
export function useOptionalMessageClient({
  appId,
  appInstallationId,
}: {
  appId: string | undefined
  appInstallationId: string | undefined
}): { messageClient: MessageClient | undefined; initError: Error | null } {
  const appStore = useAppStore()
  const [initError, setInitError] = useState<Error | null>(null)

  // Subscribe to messageClientChanged for useSyncExternalStore
  const subscribe = useCallback(
    (callback: () => void) => {
      if (!appId || !appInstallationId) return () => {}

      return appStore.events.messageClientChanged.addListener((event) => {
        if (event.appId === appId && event.appInstallationId === appInstallationId) {
          callback()
        }
      })
    },
    [appId, appInstallationId, appStore]
  )

  const getSnapshot = useCallback(() => {
    if (!appId || !appInstallationId) return undefined
    return appStore.getMessageClient({ appId, appInstallationId })
  }, [appId, appInstallationId, appStore])

  const messageClient = useSyncExternalStore(subscribe, getSnapshot, () => undefined)

  // Subscribe to renderErrored to capture bundle-load failures
  useEffect(() => {
    if (!appId || !appInstallationId) return

    return appStore.events.renderErrored.addListener((event) => {
      if (event.appId === appId && event.appInstallationId === appInstallationId) {
        setInitError(event.error)
      }
    })
  }, [appId, appInstallationId, appStore])

  // Clear error when client becomes available (e.g., after retry)
  const prevClientRef = useRef(messageClient)
  useEffect(() => {
    if (messageClient && !prevClientRef.current) {
      setInitError(null)
    }
    prevClientRef.current = messageClient
  }, [messageClient])

  return { messageClient, initError }
}
