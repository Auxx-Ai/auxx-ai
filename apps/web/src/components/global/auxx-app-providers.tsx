// apps/web/src/components/global/auxx-app-providers.tsx
'use client'

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type { ReactNode } from 'react'
import { FilesystemProvider } from '~/components/files/provider/filesystem-provider'
import { ResourceProvider } from '~/components/resources'
import { useResourceSync } from '~/components/resources/hooks/use-resource-sync'
import { useRealtimeLifecycle } from '~/realtime/use-realtime-lifecycle'

interface AuxxAppProvidersProps {
  children: ReactNode
}

/**
 * Minimum provider stack required to render record-bound surfaces:
 * resources, filesystem, popover host, plus realtime sync hooks.
 *
 * Mounted by:
 * - `AppLayoutWrapper` for the main protected web app (which then wraps
 *   chrome-only providers around it)
 * - `/embed/record/[recordId]` for the extension iframe (mounted directly,
 *   no chrome)
 *
 * Must sit BELOW `DehydratedStateProvider`, `OrganizationIdProvider`, and
 * `FeatureFlagProvider` — `useResourceSync` reads `hasAccess`.
 */
export function AuxxAppProviders({ children }: AuxxAppProvidersProps) {
  useRealtimeLifecycle()
  useResourceSync()

  return (
    <ResourceProvider>
      <FilesystemProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </FilesystemProvider>
    </ResourceProvider>
  )
}
