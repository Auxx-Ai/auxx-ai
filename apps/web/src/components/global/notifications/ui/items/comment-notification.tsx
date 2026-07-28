// apps/web/src/components/global/notifications/ui/items/comment-notification.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { MessageSquare } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { threadHref } from '~/components/kbar/thread-href'
import { useRecordEditorStore } from '~/components/records/record-editor-store'
import { useRecord } from '~/components/resources/hooks/use-record'
import type { RecordMeta } from '~/components/resources/store/record-store'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { useThread } from '~/components/threads/hooks'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis, NotificationActor, NotificationRecord } from '../notification-chips'
import { notificationMetadata } from '../notification-metadata'
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
      // Threads are addressed through `useThread` here, not the record store, so
      // the subject is emphasised text rather than a RecordBadge.
      on={thread.subject ? <Emphasis>{thread.subject}</Emphasis> : undefined}
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
      on={<NotificationRecord recordId={recordId} />}
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

/**
 * Shared shell for the three comment notification types. `on` is the parent the
 * comment hangs off — a record badge, or the thread subject when the comment is on
 * a mail thread.
 */
function CommentRow({
  notification,
  on,
  onOpen,
  onDelete,
  onRead,
}: {
  notification: NotificationEntity<'COMMENT'>
  on?: React.ReactNode
  onOpen: () => void
  onDelete: (id: string) => void
  onRead: (id: string) => void
}) {
  const metadata = notificationMetadata(notification)
  const actor = <NotificationActor notification={notification} />
  const context = on ? <> on {on}</> : null

  const message =
    metadata?.kind === 'COMMENT_MENTION' ? (
      <>
        {actor} mentioned you{context}
      </>
    ) : metadata?.kind === 'COMMENT_REPLY' ? (
      <>
        {actor} replied to your comment{context}
      </>
    ) : metadata?.kind === 'COMMENT_REACTION' ? (
      <>
        {actor} reacted to your comment{context}
      </>
    ) : (
      notification.message
    )

  const snippet =
    metadata?.kind === 'COMMENT_REACTION'
      ? metadata.reaction
      : metadata?.kind === 'COMMENT_MENTION' || metadata?.kind === 'COMMENT_REPLY'
        ? metadata.snippet
        : undefined

  return (
    <NotificationRow
      {...notification}
      subtitle={snippet}
      icon={<MessageSquare className='size-4' />}
      onOpen={onOpen}
      onDelete={onDelete}
      onRead={onRead}>
      {message}
    </NotificationRow>
  )
}
