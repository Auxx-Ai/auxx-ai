// apps/web/src/components/apps/host/app-widget.tsx
'use client'

import { Suspense } from 'react'
import { useWidget } from '~/components/apps/runtime/hooks/use-widget'
import { reconstructReactTree } from '~/components/apps/runtime/reconstruct-react-tree'
import { ErrorBoundary } from './error-boundary'

/**
 * Props for the AppWidget component.
 */
interface AppWidgetProps {
  appId: string
  appInstallationId: string
  widgetId: string
  surfaceProps: Record<string, any>
}

/**
 * Inner component that actually renders the widget.
 * This component will suspend until the widget is ready.
 */
function AppWidgetInner({ appId, appInstallationId, widgetId, surfaceProps }: AppWidgetProps) {
  // This will suspend until widget is rendered
  const widgetInstance = useWidget({
    appId,
    appInstallationId,
    widgetId,
    surfaceProps,
  })

  // Reconstruct React tree from serialized instance
  const element = reconstructReactTree(widgetInstance)

  return <>{element}</>
}

/**
 * Extension widget with error boundary and suspense.
 *
 * This component:
 * - Handles loading state via Suspense
 * - Catches and displays errors via ErrorBoundary
 * - Manages widget lifecycle automatically
 * - Reconstructs React tree from serialized format
 *
 * - Suspense for async loading
 * - Error boundaries for isolation
 * - Automatic mount/unmount via useWidget
 *
 * @example
 * ```tsx
 * <AppWidget
 *   appId="my-app"
 *   appInstallationId="install-123"
 *   widgetId="my-widget"
 *   surfaceProps={{ recordId: '123', objectType: 'ticket' }}
 * />
 * ```
 */
export function AppWidget(props: AppWidgetProps) {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className='flex h-24 items-center justify-center'>
            <div className='text-sm text-muted-foreground'>Loading widget...</div>
          </div>
        }>
        <AppWidgetInner {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
