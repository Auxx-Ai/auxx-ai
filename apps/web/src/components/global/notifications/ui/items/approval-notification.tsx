// apps/web/src/components/global/notifications/ui/items/approval-notification.tsx
'use client'

import { CircleCheck } from 'lucide-react'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis } from '../notification-chips'
import { notificationMetadata } from '../notification-metadata'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

/**
 * Workflow approval requests, reminders and completions.
 *
 * There is no actor chip here — approvals are raised by the workflow engine, not a
 * teammate — so the row leads with the ask and names the workflow instead. The name
 * comes straight from metadata; there is nothing to fetch.
 *
 * Opening switches the panel to the Approvals tab and highlights the matching
 * request there, rather than launching a separate dialog.
 */
export function ApprovalNotification({
  notification,
  onDelete,
  onRead,
}: NotificationItemProps<'APPROVAL'>) {
  const openApprovals = useNotificationPanelStore((state) => state.openApprovals)
  const metadata = notificationMetadata(notification)
  const workflowName =
    metadata?.kind === 'WORKFLOW_APPROVAL_REQUIRED' ||
    metadata?.kind === 'WORKFLOW_APPROVAL_REMINDER' ||
    metadata?.kind === 'WORKFLOW_APPROVAL_COMPLETED'
      ? metadata.workflowName
      : undefined

  // Completions keep their sender-written message; requests and reminders get the
  // composed lead so the workflow name can be emphasised.
  const lead =
    metadata?.kind === 'WORKFLOW_APPROVAL_REQUIRED'
      ? 'Approval required'
      : metadata?.kind === 'WORKFLOW_APPROVAL_REMINDER'
        ? 'Approval reminder'
        : null

  return (
    <NotificationRow
      {...notification}
      subtitle={lead ? undefined : workflowName}
      icon={<CircleCheck className='size-4' />}
      onOpen={() => openApprovals(notification.targetIds.approvalRequestId)}
      onDelete={onDelete}
      onRead={onRead}>
      {lead ? (
        <>
          {lead}
          {workflowName ? (
            <>
              {' '}
              for <Emphasis>{workflowName}</Emphasis>
            </>
          ) : null}
        </>
      ) : (
        notification.message
      )}
    </NotificationRow>
  )
}
