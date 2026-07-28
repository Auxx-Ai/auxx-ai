// apps/web/src/components/global/notifications/hooks/use-notification-subscription.ts
'use client'

import { rooms } from '@auxx/lib/realtime/client'
import { useRef } from 'react'
import { useUser } from '~/hooks/use-user'
import { NEW_MESSAGE_SOUND, playNotificationSound } from '~/lib/play-notification-sound'
import { useDehydratedSettings } from '~/providers/dehydrated-state-provider'
import { useRealtimeRoom } from '~/realtime/hooks'
import { api } from '~/trpc/react'
import { useNotificationPanelStore } from '../notification-panel-store'

export function useNotificationSubscription(userId: string) {
  const utils = api.useUtils()
  const { organizationId } = useUser()
  const settings = useDehydratedSettings()
  const bellSoundRef = useRef(true)
  bellSoundRef.current = settings['notification.sound.bell'] !== false

  useRealtimeRoom(userId ? rooms.user(userId) : null, {
    onEvent: (event, payload) => {
      switch (event) {
        case 'notification': {
          const orgId = (payload as { organizationId?: string } | undefined)?.organizationId
          if (!orgId || !organizationId || orgId === organizationId) {
            utils.notification.getUnreadCount.setData(undefined, (previous) => ({
              count: (previous?.count ?? 0) + 1,
            }))
            if (bellSoundRef.current) playNotificationSound(NEW_MESSAGE_SOUND)
          }
          if (useNotificationPanelStore.getState().open) {
            void utils.notification.getNotifications.invalidate()
          }
          break
        }
        case 'notification:read':
        case 'notification:deleted':
          void utils.notification.getUnreadCount.invalidate()
          void utils.notification.getNotifications.invalidate()
          break
        // A workflow approval wants this user — new request or reminder re-ping.
        case 'approval': {
          const orgId = (payload as { organizationId?: string } | undefined)?.organizationId
          if (orgId && organizationId && orgId !== organizationId) break
          invalidateApprovals(utils)
          // Pulse explicitly: a reminder re-pings a request that is already
          // counted, so the bell's count-went-up pulse would never fire.
          useNotificationPanelStore.getState().pulseBell()
          if (bellSoundRef.current) playNotificationSound(NEW_MESSAGE_SOUND)
          break
        }
        // Decided, cancelled, timed out, or cleaned up with its run — the count
        // drops without a refocus. No pulse, no sound.
        case 'approval:resolved':
          invalidateApprovals(utils)
          break
      }
    },
  })
}

/**
 * Refetch both approval counts and both approval lists.
 *
 * Invalidate, never `setData`: a reminder re-publishes `approval` for a request
 * that is already counted, and `getPendingCount` filters on `expiresAt > now`
 * plus the run still being RUNNING/WAITING — predicates the client cannot
 * reproduce. An optimistic increment would inflate the badge on every reminder
 * tick and drift from the server (plans/today/05-bell-and-feed-dedupe.md §5).
 *
 * The lists are cheap to invalidate here: react-query only refetches active
 * queries, so they no-op unless the Approvals tab is actually open.
 */
function invalidateApprovals(utils: ReturnType<typeof api.useUtils>) {
  void utils.approval.getPendingCount.invalidate()
  void utils.approval.getPendingRequests.invalidate()
  void utils.approvals.count.invalidate()
  void utils.approvals.list.invalidate()
}
