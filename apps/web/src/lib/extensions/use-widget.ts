// apps/web/src/lib/extensions/use-widget.ts
'use client'

import { useSyncExternalStore } from 'react'
import { useInternalAppsContext } from '~/providers/extensions/internal-apps-context'
import { SurfaceInstanceExternalStore } from './surface-instance-external-store'

/**
 * Options for the useWidget hook.
 */
interface UseWidgetOptions {
  appId: string
  appInstallationId: string
  widgetId: string
  surfaceProps: Record<string, any> // e.g., { recordId, object }
}

/**
 * Hook to use a widget instance.
 * Suspends until widget is rendered.
 * Automatically mounts/unmounts based on component lifecycle.
 *
 * - Uses useSyncExternalStore for reactive updates
 * - Suspends until widget render is complete
 * - First component mount triggers widget mount
 * - Last component unmount triggers widget unmount
 *
 * @example
 * ```tsx
 * function MyComponent({ recordId }) {
 *   const widgetInstance = useWidget({
 *     appId: 'my-app',
 *     appInstallationId: 'install-123',
 *     widgetId: 'my-widget',
 *     surfaceProps: { recordId }
 *   })
 *
 *   // widgetInstance is the serialized render tree
 *   return <div>{reconstructReactTree(widgetInstance)}</div>
 * }
 * ```
 */
export function useWidget({ appId, appInstallationId, widgetId, surfaceProps }: UseWidgetOptions) {
  const { store } = useInternalAppsContext()

  // Get or create external store for this widget instance
  const externalStore = SurfaceInstanceExternalStore.getInstance(store, {
    appId,
    appInstallationId,
    surfaceType: 'record-widget',
    surfaceId: widgetId,
    surfaceProps,
  })

  // Subscribe to widget updates
  const snapshot = useSyncExternalStore(
    externalStore.addListener,
    externalStore.getSnapshot,
    () => null
  )

  // Suspend if not ready
  if (snapshot.status === 'pending') {
    throw new Promise<void>((resolve) => {
      const unsubscribe = externalStore.addListener(() => {
        const currentSnapshot = externalStore.getSnapshot()
        if (currentSnapshot.status === 'complete') {
          unsubscribe()
          resolve()
        }
      })
    })
  }

  return snapshot.value
}
