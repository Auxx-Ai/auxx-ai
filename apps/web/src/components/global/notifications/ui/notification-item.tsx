// apps/web/src/components/global/notifications/ui/notification-item.tsx
'use client'

import type { NotificationEntity } from '@auxx/lib/notifications/client'
import { ApprovalNotification } from './items/approval-notification'
import { CommentNotification } from './items/comment-notification'
import { EntityInstanceNotification } from './items/entity-instance-notification'
import {
  DashboardNotification,
  DatasetNotification,
  KnowledgeBaseNotification,
  WorkflowNotification,
} from './items/resource-notifications'
import { SettingsNotification } from './items/settings-notification'
import { StaticNotification } from './items/static-notification'
import { TaskNotification } from './items/task-notification'
import { ThreadNotification } from './items/thread-notification'

interface NotificationItemDispatchProps {
  notification: NotificationEntity
  onDelete: (id: string) => void
  onRead: (id: string) => void
  onOpenApproval: (id: string) => void
}

/** Dispatch a notification to the renderer for its destination type. */
export function NotificationItemDispatch(props: NotificationItemDispatchProps) {
  switch (props.notification.targetType) {
    case 'ENTITY_INSTANCE':
      return (
        <EntityInstanceNotification
          {...props}
          notification={props.notification as NotificationEntity<'ENTITY_INSTANCE'>}
        />
      )
    case 'THREAD':
      return (
        <ThreadNotification
          {...props}
          notification={props.notification as NotificationEntity<'THREAD'>}
        />
      )
    case 'TASK':
      return (
        <TaskNotification
          {...props}
          notification={props.notification as NotificationEntity<'TASK'>}
        />
      )
    case 'COMMENT':
      return (
        <CommentNotification
          {...props}
          notification={props.notification as NotificationEntity<'COMMENT'>}
        />
      )
    case 'APPROVAL':
      return (
        <ApprovalNotification
          {...props}
          notification={props.notification as NotificationEntity<'APPROVAL'>}
        />
      )
    case 'DATASET':
      return (
        <DatasetNotification
          {...props}
          notification={props.notification as NotificationEntity<'DATASET'>}
        />
      )
    case 'KNOWLEDGE_BASE':
      return (
        <KnowledgeBaseNotification
          {...props}
          notification={props.notification as NotificationEntity<'KNOWLEDGE_BASE'>}
        />
      )
    case 'DASHBOARD':
      return (
        <DashboardNotification
          {...props}
          notification={props.notification as NotificationEntity<'DASHBOARD'>}
        />
      )
    case 'WORKFLOW':
      return (
        <WorkflowNotification
          {...props}
          notification={props.notification as NotificationEntity<'WORKFLOW'>}
        />
      )
    case 'SETTINGS':
      return (
        <SettingsNotification
          {...props}
          notification={props.notification as NotificationEntity<'SETTINGS'>}
        />
      )
    default:
      return <StaticNotification {...props} notification={props.notification} />
  }
}
