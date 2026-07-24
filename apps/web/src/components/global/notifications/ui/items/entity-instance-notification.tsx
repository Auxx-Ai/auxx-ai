// apps/web/src/components/global/notifications/ui/items/entity-instance-notification.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { useRouter } from 'next/navigation'
import { useRecordEditorStore } from '~/components/records/record-editor-store'
import { useRecord } from '~/components/resources/hooks/use-record'
import { useResource } from '~/components/resources/hooks/use-resource'
import type { RecordMeta } from '~/components/resources/store/record-store'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordLink } from '~/components/resources/utils/get-record-link'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

export function EntityInstanceNotification(props: NotificationItemProps<'ENTITY_INSTANCE'>) {
  const { notification, onDelete, onRead } = props
  const { entityDefinitionId, entityInstanceId } = notification.targetIds
  const recordId = toRecordId(entityDefinitionId, entityInstanceId)
  const { record, isLoading, isNotFound } = useRecord<RecordMeta>({ recordId })
  const { resource } = useResource(entityDefinitionId)
  const href = useRecordLink(recordId)
  const router = useRouter()
  const close = useNotificationPanelStore((state) => state.close)

  if (isNotFound) return <UnavailableNotification {...props} />
  if (isLoading || !record || !resource) return <NotificationRowSkeleton />

  const copy = getNotificationCopy(notification)
  const open = () => {
    if (href) {
      router.push(href)
    } else {
      useRecordEditorStore.getState().openEditor({ entityDefinitionId, recordId })
    }
    close()
  }

  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle ?? record.displayName ?? resource.label}
      actor={notification.actor}
      icon={
        <RecordIcon
          iconId={resource.icon}
          color={resource.color}
          avatarUrl={record.avatarUrl ?? undefined}
          size='xs'
        />
      }
      onOpen={open}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
