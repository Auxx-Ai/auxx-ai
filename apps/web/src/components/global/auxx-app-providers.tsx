// apps/web/src/components/global/auxx-app-providers.tsx
'use client'

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import type { ReactNode } from 'react'
import { FavoritesProvider } from '~/components/favorites/providers/favorites-provider'
import { FilesystemProvider } from '~/components/files/provider/filesystem-provider'
import { useNewMessageIndicator } from '~/components/global/new-message-indicator/use-new-message-indicator'
import { useNotificationSubscription } from '~/components/global/notifications/notification-center'
import { ResourceProvider } from '~/components/resources'
import { useResourceSync } from '~/components/resources/hooks/use-resource-sync'
import { useMailSync } from '~/components/threads/realtime'
import { usePresenceHeartbeat } from '~/hooks/use-presence-heartbeat'
import { useUser } from '~/hooks/use-user'
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
  const { user } = useUser()
  useRealtimeLifecycle()
  usePresenceHeartbeat()
  useResourceSync()
  useMailSync()
  // Out-of-tab new-message indicator: favicon dot + tab-title prefix, driven by
  // the same inbound `message:created` arrival as the in-app toast cue.
  useNewMessageIndicator()
  // Live notification-bell updates: subscribes to the user's private channel
  // so the dropdown list + unread badge refresh the instant a notification
  // lands, instead of only on popover-open / window-focus refetch.
  useNotificationSubscription(user?.id ?? '')

  return (
    <ResourceProvider>
      <FilesystemProvider>
        <FavoritesProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </FavoritesProvider>
      </FilesystemProvider>
    </ResourceProvider>
  )
}
