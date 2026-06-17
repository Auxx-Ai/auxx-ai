// apps/web/src/components/apps/host/data-handlers/render-data-handler.tsx
'use client'

import { useEffect } from 'react'
import { useAppDataHandlerContext } from '~/components/apps/providers/app-data-handler-context'
import { useInternalAppsContext } from '~/components/apps/providers/internal-apps-context'

/**
 * Listens for render updates and errors from extension.
 * Handles the 'render' and 'render-error' messages from extensions.
 */
export function RenderDataHandler() {
  const { appId, appInstallationId, isDevLoggingEnabled, messageClient } =
    useAppDataHandlerContext()
  const { store } = useInternalAppsContext()

  useEffect(() => {
    // Listen for render updates
    const unsubscribeRender = messageClient.listenForRequest('render', ({ root }) => {
      // Handle extensions with no UI component (server-only extensions)
      if (!root) {
        if (isDevLoggingEnabled) {
          console.log(`[RenderDataHandler] App(${appId}) has no UI component`)
        }
        return null
      }

      // Validate render tree
      if (!root.children || !Array.isArray(root.children)) {
        console.error(`[RenderDataHandler] Invalid render tree from App(${appId}):`, root)
        return null
      }

      // Update render in AppStore
      store.updateRender({
        appId,
        appInstallationId,
        children: root.children,
      })

      // Dev logging
      if (isDevLoggingEnabled) {
        console.log(`[RenderDataHandler] App(${appId}) rendered ${root.children.length} elements`)
      }

      return null
    })

    // Listen for render errors
    const unsubscribeError = messageClient.listenForRequest('render-error', ({ error }) => {
      console.error(`[RenderDataHandler] Render error from App(${appId}):`, error)

      // Report error to AppStore
      store.reportRenderError({
        appId,
        appInstallationId,
        error: new Error(error || 'Unknown render error'),
      })

      return null
    })

    return () => {
      unsubscribeRender()
      unsubscribeError()
    }
  }, [appId, appInstallationId, isDevLoggingEnabled, messageClient, store])

  return null
}
