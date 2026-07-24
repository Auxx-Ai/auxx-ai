// apps/web/src/components/global/notifications/ui/items/static-notification.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { getNotificationCopy } from '../../copy/notification-copy'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

export function StaticNotification({
  notification,
  onDelete,
  onRead,
}:
  | NotificationItemProps<'NONE'>
  | {
      notification: NotificationEntity
      onDelete: (id: string) => void
      onRead: (id: string) => void
    }) {
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle}
      actor={notification.actor}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}

export function UnavailableNotification({
  notification,
  onDelete,
  onRead,
}: {
  notification: NotificationEntity
  onDelete: (id: string) => void
  onRead: (id: string) => void
}) {
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle='This item is no longer available.'
      actor={notification.actor}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
