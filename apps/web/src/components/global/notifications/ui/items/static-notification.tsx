// apps/web/src/components/global/notifications/ui/items/static-notification.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

/**
 * The `NONE` target and the dispatch's fallback branch. There is no target to
 * resolve and no guaranteed metadata shape, so the sender's message is the message.
 */
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
  return (
    <NotificationRow {...notification} onDelete={onDelete} onRead={onRead}>
      {notification.message}
    </NotificationRow>
  )
}

/**
 * A notification whose target is gone — a revoked share, a deleted record. Not
 * clickable, and it keeps the sender's message rather than a composed sentence:
 * the live name a chip would resolve is exactly what is no longer available.
 */
export function UnavailableNotification({
  notification,
  onDelete,
  onRead,
}: {
  notification: NotificationEntity
  onDelete: (id: string) => void
  onRead: (id: string) => void
}) {
  return (
    <NotificationRow
      {...notification}
      subtitle='This item is no longer available.'
      onDelete={onDelete}
      onRead={onRead}>
      {notification.message}
    </NotificationRow>
  )
}
