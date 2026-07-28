// apps/web/src/components/global/notifications/ui/items/settings-notification.tsx
'use client'

import { Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

/**
 * Deep links into settings — plan overages, the automated-send guard. Every sender
 * on this target writes its own prose and carries no copy template, so the message
 * is shown as written.
 */
export function SettingsNotification({
  notification,
  onDelete,
  onRead,
}: NotificationItemProps<'SETTINGS'>) {
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)
  return (
    <NotificationRow
      {...notification}
      icon={<Settings className='size-4' />}
      onOpen={() => {
        router.push(notification.targetIds.path)
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}>
      {notification.message}
    </NotificationRow>
  )
}
