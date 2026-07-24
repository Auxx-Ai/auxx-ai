// apps/web/src/components/global/notifications/copy/notification-copy.tsx
'use client'

import type { NotificationEntity, NotificationMetadata } from '@auxx/lib/notifications/client'
import { LENS_LABELS } from '@auxx/lib/permissions/visibility/client'
import { format, isValid, parseISO } from 'date-fns'
import { INSTANCE_SHARE_COPY } from '~/components/permissions/ui/instance-share-copy'

export interface NotificationCopy {
  title: string
  subtitle?: string
}

function actorName(notification: NotificationEntity): string {
  return notification.actor?.name ?? 'A teammate'
}

function matchingMetadata(notification: NotificationEntity): NotificationMetadata | null {
  const metadata = notification.metadata
  return metadata?.kind === notification.type ? metadata : null
}

/** Compose client-facing notification copy, with the persisted message as a safe fallback. */
export function getNotificationCopy(notification: NotificationEntity): NotificationCopy {
  const metadata = matchingMetadata(notification)
  if (!metadata) return { title: notification.message }

  switch (metadata.kind) {
    case 'COMMENT_MENTION':
      return {
        title: `${actorName(notification)} mentioned you${
          metadata.recordName ? ` on ${metadata.recordName}` : ''
        }`,
        subtitle: metadata.snippet,
      }
    case 'COMMENT_REPLY':
      return {
        title: `${actorName(notification)} replied to your comment${
          metadata.recordName ? ` on ${metadata.recordName}` : ''
        }`,
        subtitle: metadata.snippet,
      }
    case 'COMMENT_REACTION':
      return {
        title: `${actorName(notification)} reacted to your comment${
          metadata.recordName ? ` on ${metadata.recordName}` : ''
        }`,
        subtitle: metadata.reaction,
      }
    case 'TASK_ASSIGNED': {
      const deadline = metadata.deadline ? parseISO(metadata.deadline) : null
      return {
        title: `${actorName(notification)} assigned you ${metadata.taskTitle}`,
        subtitle: deadline && isValid(deadline) ? `Due ${format(deadline, 'PPp')}` : undefined,
      }
    }
    case 'RESOURCE_SHARED':
      return {
        title: `${actorName(notification)} shared the ${metadata.noun} ${
          metadata.resourceName
        } with you`,
        subtitle: INSTANCE_SHARE_COPY[metadata.resourceKey]?.levels[metadata.level],
      }
    case 'MESSAGE_SHARED':
      return {
        title: `${actorName(notification)} shared a conversation with you`,
        subtitle: metadata.subject || LENS_LABELS[metadata.lens as keyof typeof LENS_LABELS]?.label,
      }
    case 'WORKFLOW_APPROVAL_REQUIRED':
      return {
        title: 'Approval required',
        subtitle: metadata.workflowName,
      }
    case 'WORKFLOW_APPROVAL_REMINDER':
      return {
        title: 'Approval reminder',
        subtitle: metadata.workflowName,
      }
    case 'WORKFLOW_APPROVAL_COMPLETED':
      return {
        title: notification.message,
        subtitle: metadata.workflowName,
      }
    default:
      return { title: notification.message }
  }
}
