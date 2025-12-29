// apps/web/src/components/extensions/data-handlers/assets-data-handler.tsx
'use client'

import { useEffect } from 'react'
import { useExtensionDataHandlerContext } from '~/providers/extensions/extension-data-handler-context'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'

/**
 * Listens for asset registration from extension and updates AppStore.
 * Handles the 'set-assets' message from extensions to register their static assets.
 */
export function AssetsDataHandler() {
  const { appId, appInstallationId, isDevLoggingEnabled, messageClient } =
    useExtensionDataHandlerContext()
  const { store } = useInternalAppsContext()

  useEffect(() => {
    // Listen for set-assets message
    const unsubscribe = messageClient.listenForRequest('set-assets', ({ assets }) => {
      // Validate assets
      if (!Array.isArray(assets)) {
        console.error(`[AssetsDataHandler] Invalid assets from App(${appId}):`, assets)
        return null
      }

      // Validate each asset has name and data
      const validAssets = assets.filter((asset) => {
        if (!asset.name || typeof asset.name !== 'string') {
          console.error(`[AssetsDataHandler] Asset missing name from App(${appId}):`, asset)
          return false
        }
        if (!asset.data || typeof asset.data !== 'string') {
          console.error(`[AssetsDataHandler] Asset missing data from App(${appId}):`, asset)
          return false
        }
        return true
      })

      // Register assets in AppStore
      store.registerAssets({
        appId,
        appInstallationId,
        assets: validAssets,
      })

      // Dev logging
      if (isDevLoggingEnabled) {
        console.log(
          `[AssetsDataHandler] App(${appId}) registered ${validAssets.length} assets:`,
          validAssets.map((a) => a.name)
        )
      }

      return null
    })

    return unsubscribe
  }, [appId, appInstallationId, isDevLoggingEnabled, messageClient, store])

  return null
}
