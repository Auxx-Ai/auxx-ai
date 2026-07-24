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
      }
    },
  })
}
