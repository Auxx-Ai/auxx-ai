// apps/web/src/lib/extensions/use-surfaces.ts
'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'
import type { Surface } from './app-store'

/**
 * Options for useSurfaces hook.
 */
interface UseSurfacesOptions {
  surfaceType: string
  context?: any // Context for predicate evaluation (e.g., { recordId, objectType })
}

/**
 * Surface with metadata about the extension.
 */
interface SurfaceWithMetadata {
  surface: Surface
  appId: string
  appInstallationId: string
  appTitle: string
}

/**
 * Result type for useSurfaces when used without options (returns all surfaces).
 */
interface UseSurfacesAllResult {
  data: ReturnType<typeof import('./app-store').AppStore.prototype.getAllSurfaces>
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
}

/**
 * Result type for useSurfaces when used with options (returns filtered surfaces).
 */
interface UseSurfacesFilteredResult {
  data: SurfaceWithMetadata[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
}

/**
 * Hook to get ALL surfaces from all extensions (for testing/debugging).
 * Returns React Query-style result with loading states.
 *
 * Example:
 *   const { data: allSurfaces, isLoading, isSuccess } = useSurfaces()
 *   const { data: actions, isLoading } = useSurfaces({ surfaceType: 'record-action' })
 */
export function useSurfaces(): UseSurfacesAllResult
export function useSurfaces(options: UseSurfacesOptions): UseSurfacesFilteredResult
export function useSurfaces(
  options?: UseSurfacesOptions
): UseSurfacesAllResult | UseSurfacesFilteredResult {
  const { store } = useInternalAppsContext()
  const { appInstallations, isLoading, isError } = useExtensionsContext()

  // Subscribe to surface changes
  const subscribe = useCallback(
    (callback: () => void) => {
      // During loading, return no-op subscription
      if (isLoading || appInstallations.length === 0) {
        return () => {}
      }

      const unsubscribers = appInstallations.map((installation) =>
        store
          .surfacesChanged({
            appId: installation.app.id,
            appInstallationId: installation.installationId,
          })
          .addListener(callback)
      )

      // Also subscribe to global surfaces changed event
      const globalUnsubscribe = store.events.surfacesChanged.addListener(callback)

      return () => {
        unsubscribers.forEach((fn) => fn())
        globalUnsubscribe()
      }
    },
    [appInstallations, store, isLoading]
  )

  // Get snapshot of all surfaces
  const getSnapshot = useCallback(() => {
    return store.getAllSurfaces()
  }, [store])

  const allSurfaces = useSyncExternalStore(subscribe, getSnapshot, () => null)

  // Calculate success state
  const isSuccess = !isLoading && !isError

  // If no options provided, return all surfaces with status
  if (!options) {
    return {
      data: allSurfaces,
      isLoading,
      isError,
      isSuccess,
    }
  }

  // Otherwise, filter and return surfaces of specific type
  const { surfaceType, context = {} } = options

  // Filter and map surfaces
  const filteredSurfaces = useMemo(() => {
    const result: SurfaceWithMetadata[] = []

    for (const [key, { surfaces }] of allSurfaces.entries()) {
      const [appId, appInstallationId] = key.split(':')
      const installation = appInstallations.find(
        (i) => i.app.id === appId && i.installationId === appInstallationId
      )

      if (!installation) continue

      const surfacesOfType = surfaces[surfaceType]
      if (!surfacesOfType) continue

      for (const surface of surfacesOfType) {
        // Check if surface should be shown (predicate evaluation)
        const shouldShow = store.shouldShowSurface({
          appId: appId!,
          appInstallationId: appInstallationId!,
          surfaceType,
          surfaceId: surface.id,
          context,
        })

        if (shouldShow) {
          result.push({
            surface,
            appId: appId!,
            appInstallationId: appInstallationId!,
            appTitle: installation.app.title,
          })
        }
      }
    }

    return result
  }, [allSurfaces, appInstallations, surfaceType, context, store])

  return {
    data: filteredSurfaces,
    isLoading,
    isError,
    isSuccess,
  }
}
