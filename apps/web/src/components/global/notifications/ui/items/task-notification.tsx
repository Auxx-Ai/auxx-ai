// apps/web/src/components/global/notifications/ui/items/task-notification.tsx
'use client'

import { ClipboardCheck } from 'lucide-react'
import { useTask } from '~/components/tasks/hooks/use-task'
import { useTaskEditorStore } from '~/components/tasks/stores/task-editor-store'
import { getNotificationCopy } from '../../copy/notification-copy'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

export function TaskNotification(props: NotificationItemProps<'TASK'>) {
  const { notification, onDelete, onRead } = props
  const taskId = notification.targetIds.taskId
  const { task, isLoading, error } = useTask({ taskId })
  const close = useNotificationPanelStore((state) => state.close)

  if (error) return <UnavailableNotification {...props} />
  if (isLoading || !task) return <NotificationRowSkeleton />

  const copy = getNotificationCopy(notification)
  return (
    <NotificationRow
      {...notification}
      title={copy.title}
      subtitle={copy.subtitle ?? task.title}
      actor={notification.actor}
      icon={<ClipboardCheck className='size-4' />}
      onOpen={() => {
        useTaskEditorStore.getState().openEditor(taskId)
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}
    />
  )
}
