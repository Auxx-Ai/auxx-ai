// apps/web/src/components/extensions/extension-widget.tsx
'use client'

import { Suspense } from 'react'
import { reconstructReactTree } from '~/lib/extensions/reconstruct-react-tree'
import { useWidget } from '~/lib/extensions/use-widget'
import { ErrorBoundary } from './error-boundary'

/**
 * Props for the ExtensionWidget component.
 */
interface ExtensionWidgetProps {
  appId: string
  appInstallationId: string
  widgetId: string
  surfaceProps: Record<string, any>
}

/**
 * Inner component that actually renders the widget.
 * This component will suspend until the widget is ready.
 */
function ExtensionWidgetInner({
  appId,
  appInstallationId,
  widgetId,
  surfaceProps,
}: ExtensionWidgetProps) {
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
 * <ExtensionWidget
 *   appId="my-app"
 *   appInstallationId="install-123"
 *   widgetId="my-widget"
 *   surfaceProps={{ recordId: '123', objectType: 'ticket' }}
 * />
 * ```
 */
export function ExtensionWidget(props: ExtensionWidgetProps) {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className='flex h-24 items-center justify-center'>
            <div className='text-sm text-muted-foreground'>Loading widget...</div>
          </div>
        }>
        <ExtensionWidgetInner {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
