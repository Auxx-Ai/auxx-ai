// apps/web/src/components/global/notifications/ui/items/thread-notification.tsx
'use client'

import { Mail } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { threadHref } from '~/components/kbar/thread-href'
import { useThread } from '~/components/threads/hooks'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis, NotificationActor } from '../notification-chips'
import { lensLabel, notificationMetadata } from '../notification-metadata'
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

  const metadata = notificationMetadata(notification)
  // The live subject beats the one captured at send time; fall back to metadata
  // for a thread whose subject has since been cleared.
  const subject = thread.subject || (metadata?.kind === 'MESSAGE_SHARED' ? metadata.subject : null)

  return (
    <NotificationRow
      {...notification}
      subtitle={metadata?.kind === 'MESSAGE_SHARED' ? lensLabel(metadata.lens) : thread.subject}
      icon={<Mail className='size-4' />}
      onOpen={() => {
        router.push(threadHref(thread))
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}>
      {metadata?.kind === 'MESSAGE_SHARED' ? (
        <>
          <NotificationActor notification={notification} /> shared{' '}
          {subject ? <Emphasis>{subject}</Emphasis> : 'a conversation'} with you
        </>
      ) : (
        notification.message
      )}
    </NotificationRow>
  )
}
