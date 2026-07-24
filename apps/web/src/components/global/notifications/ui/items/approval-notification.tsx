// apps/web/src/components/global/notifications/ui/items/approval-notification.tsx
'use client'

import { CircleCheck } from 'lucide-react'
import { getNotificationCopy } from '../../copy/notification-copy'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

export function ApprovalNotification({
  notification,
  onDelete,
  onRead,
  onOpenApproval,
}: NotificationItemProps<'APPROVAL'> & { onOpenApproval: (id: string) => void }) {
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle}
      actor={notification.actor}
      icon={<CircleCheck className='size-4' />}
      onOpen={() => onOpenApproval(notification.targetIds.approvalRequestId)}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
