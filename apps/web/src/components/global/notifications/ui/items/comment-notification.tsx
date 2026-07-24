// apps/web/src/components/global/notifications/ui/items/comment-notification.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { threadHref } from '~/components/kbar/thread-href'
import { useRecordEditorStore } from '~/components/records/record-editor-store'
import { useRecord } from '~/components/resources/hooks/use-record'
import type { RecordMeta } from '~/components/resources/store/record-store'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { useThread } from '~/components/threads/hooks'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

export function CommentNotification(props: NotificationItemProps<'COMMENT'>) {
  const parsed = parseRecordId(props.notification.targetIds.recordId)
  return parsed.entityDefinitionId === 'thread' ? (
    <ThreadCommentNotification {...props} threadId={parsed.entityInstanceId} />
  ) : (
    <EntityCommentNotification {...props} entityDefinitionId={parsed.entityDefinitionId} />
  )
}

function ThreadCommentNotification(props: NotificationItemProps<'COMMENT'> & { threadId: string }) {
  const { notification, onDelete, onRead, threadId } = props
  const { thread, isLoading, isNotFound } = useThread({ threadId })
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)

  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !thread) return <NotificationRowSkeleton />

  return (
    <CommentRow
      notification={notification}
      onDelete={onDelete}
      onRead={onRead}
      subtitle={thread.subject}
      onOpen={() => {
        router.push(`${threadHref(thread)}#comment-${notification.targetIds.commentId}`)
        close()
      }}
    />
  )
}

function EntityCommentNotification(
  props: NotificationItemProps<'COMMENT'> & { entityDefinitionId: string }
) {
  const { notification, onDelete, onRead, entityDefinitionId } = props
  const recordId = notification.targetIds.recordId
  const { record, isLoading, isNotFound } = useRecord<RecordMeta>({ recordId })
  const href = useRecordLink(recordId)
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)

  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !record) return <NotificationRowSkeleton />

  return (
    <CommentRow
      notification={notification}
      onDelete={onDelete}
      onRead={onRead}
      subtitle={record.displayName}
      onOpen={() => {
        if (href) {
          const separator = href.includes('?') ? '&' : '?'
          router.push(`${href}${separator}tab=activity#comment-${notification.targetIds.commentId}`)
        } else {
          useRecordEditorStore.getState().openEditor({ entityDefinitionId, recordId })
        }
        close()
      }}
    />
  )
}

function CommentRow({
  notification,
  subtitle,
  onOpen,
  onDelete,
  onRead,
}: {
  notification: NotificationEntity<'COMMENT'>
  subtitle?: string | null
  onOpen: () => void
  onDelete: (id: string) => void
  onRead: (id: string) => void
}) {
  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle ?? subtitle}
      actor={notification.actor}
      icon={<MessageSquare className='size-4' />}
      onOpen={onOpen}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
