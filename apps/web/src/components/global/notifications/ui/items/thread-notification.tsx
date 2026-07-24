// apps/web/src/components/global/notifications/ui/items/thread-notification.tsx
'use client'

import { Mail } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { threadHref } from '~/components/kbar/thread-href'
import { useThread } from '~/components/threads/hooks'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

export function ThreadNotification(props: NotificationItemProps<'THREAD'>) {
  const { notification, onDelete, onRead } = props
  const { thread, isLoading, isNotFound } = useThread({
    threadId: notification.targetIds.threadId,
  })
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)

  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !thread) return <NotificationRowSkeleton />

  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle ?? thread.subject}
      actor={notification.actor}
      icon={<Mail className='size-4' />}
      onOpen={() => {
        router.push(threadHref(thread))
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
