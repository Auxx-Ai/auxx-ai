// apps/web/src/components/global/notifications/ui/items/settings-notification.tsx
'use client'

import { Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

export function SettingsNotification({
  notification,
  onDelete,
  onRead,
}: NotificationItemProps<'SETTINGS'>) {
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle}
      actor={notification.actor}
      icon={<Settings className='size-4' />}
      onOpen={() => {
        router.push(notification.targetIds.path)
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
