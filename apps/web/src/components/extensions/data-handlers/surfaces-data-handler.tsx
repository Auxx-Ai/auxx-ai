// apps/web/src/components/extensions/data-handlers/surfaces-data-handler.tsx
'use client'

import { useEffect } from 'react'
import { useExtensionDataHandlerContext } from '~/providers/extensions/extension-data-handler-context'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Listens for surface registration from extension and updates AppStore.
 * Handles the 'set-surfaces' message from extensions to register their UI surfaces.
 */
export function SurfacesDataHandler() {
  const { appId, appInstallationId, isDevLoggingEnabled, messageClient } =
    useExtensionDataHandlerContext()
  const { store } = useInternalAppsContext()

  useEffect(() => {
    // Listen for set-surfaces message
    const unsubscribe = messageClient.listenForRequest('set-surfaces', ({ surfaces }) => {
      // Register surfaces in AppStore
      store.registerSurfaces({
        appId,
        appInstallationId,
        surfaces,
      })

      // Dev logging
      if (isDevLoggingEnabled) {
        if (Object.keys(surfaces).length === 0) {
          console.log(`[SurfacesDataHandler] App(${appId}) registered no surfaces`)
        } else {
          console.log(`[SurfacesDataHandler] App(${appId}) registered surfaces:`, {
            types: Object.keys(surfaces),
            counts: Object.fromEntries(
              Object.entries(surfaces).map(([type, items]) => [
                type,
                Array.isArray(items) ? items.length : 0,
              ])
            ),
          })
        }
      }

      // No response needed
      return null
    })

    return unsubscribe
  }, [appId, appInstallationId, isDevLoggingEnabled, messageClient, store])

  // This component doesn't render anything
  return null
}
