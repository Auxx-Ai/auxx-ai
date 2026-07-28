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
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRecord } from '../notification-chips'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

/**
 * Records — tickets, work orders, visits, quotes, record-rule notices.
 *
 * Every sender on this target (record rules, dispatch, quote acceptance) writes
 * its own prose into `message` and carries no copy template, so the message line
 * stays as written. The record itself surfaces as a badge on the subtitle line,
 * which is where the plain display name used to sit.
 */
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
      subtitle={<NotificationRecord recordId={recordId} size='sm' />}
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
      onRead={onRead}>
      {notification.message}
    </NotificationRow>
  )
}
