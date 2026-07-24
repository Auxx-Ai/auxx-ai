// apps/web/src/components/global/notifications/ui/items/item-props.ts

import type { NotificationEntity, NotificationTargetType } from '@auxx/lib/notifications/client'

export interface NotificationItemProps<T extends NotificationTargetType> {
  notification: NotificationEntity<T>
  onDelete: (id: string) => void
  onRead: (id: string) => void
}
