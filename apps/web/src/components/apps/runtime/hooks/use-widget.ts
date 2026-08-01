// apps/web/src/components/apps/runtime/hooks/use-widget.ts
'use client'

import { useSyncExternalStore } from 'react'
import { useInternalAppsContext } from '~/components/apps/providers/internal-apps-context'
import {
  type SnapshotResult,
  SurfaceInstanceExternalStore,
} from '../surface-instance-external-store'

/** Widgets only ever render in the browser, so the server snapshot is always
 *  pending. Must be a stable reference — React re-reads it every render. */
const SERVER_SNAPSHOT: SnapshotResult = { status: 'pending' }

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
    () => SERVER_SNAPSHOT
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
