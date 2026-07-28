// apps/web/src/components/global/notifications/ui/items/task-notification.tsx
'use client'

import { ClipboardCheck } from 'lucide-react'
import { useTask } from '~/components/tasks/hooks/use-task'
import { useTaskEditorStore } from '~/components/tasks/stores/task-editor-store'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis, NotificationActor } from '../notification-chips'
import { dueLabel, notificationMetadata } from '../notification-metadata'
import { NotificationRow, NotificationRowSkeleton } from '../notification-row'
import type { NotificationItemProps } from './item-props'
import { UnavailableNotification } from './static-notification'

/** Assignment, deadline and auto-completion notices for a single task. */
export function TaskNotification(props: NotificationItemProps<'TASK'>) {
  const { notification, onDelete, onRead } = props
  const taskId = notification.targetIds.taskId
  const { task, isLoading, error } = useTask({ taskId })
  const close = useNotificationPanelStore((state) => state.close)

  if (error) return <UnavailableNotification {...props} />
  if (isLoading || !task) return <NotificationRowSkeleton />

  const metadata = notificationMetadata(notification)
  const isAssignment = metadata?.kind === 'TASK_ASSIGNED'
  const due =
    metadata?.kind === 'TASK_ASSIGNED' || metadata?.kind === 'TASK_DEADLINE'
      ? dueLabel(metadata.deadline)
      : undefined

  return (
    <NotificationRow
      {...notification}
      // The deadline row's own message already names the task; only the
      // assignment sentence pulls the title up into the message line.
      subtitle={due ?? (isAssignment ? undefined : task.title)}
      icon={<ClipboardCheck className='size-4' />}
      onOpen={() => {
        useTaskEditorStore.getState().openEditor(taskId)
        close()
      }}
      onDelete={onDelete}
      onRead={onRead}>
      {isAssignment ? (
        <>
          <NotificationActor notification={notification} /> assigned you{' '}
          <Emphasis>{task.title}</Emphasis>
        </>
      ) : (
        notification.message
      )}
    </NotificationRow>
  )
}
