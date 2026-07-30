// apps/web/src/components/global/notifications/ui/items/approval-notification.tsx
'use client'

import { CircleCheck, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis } from '../notification-chips'
import { notificationMetadata } from '../notification-metadata'
import { NotificationRow } from '../notification-row'
import type { NotificationItemProps } from './item-props'

/**
 * Everything that targets an `ApprovalRequest`: workflow confirmations, reminders
 * and completions, plus the access lane's request / decided pair (plan 42 §8).
 *
 * There is no actor chip on the workflow variants — those approvals are raised by
 * the engine, not a teammate — so the row leads with the ask and names the workflow
 * instead. The name comes straight from metadata; there is nothing to fetch.
 *
 * Opening switches the panel to the Approvals tab and highlights the matching
 * request there, rather than launching a separate dialog. For the requester's
 * DECIDED notification there is nothing to highlight — they are not an approver —
 * and `ApprovalsTab` clears an unlisted highlight silently, which is the intended
 * degrade rather than a dead end.
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

  // The access lane keeps its server-composed message (which already names the
  // durable subject label) and only takes a truthful icon: an open padlock for a
  // decision, a closed one for the ask. A green check on "your request was
  // declined" is the kind of mismatch that reads as a bug.
  const icon =
    metadata?.kind === 'ACCESS_REQUESTED' ? (
      <LockKeyhole className='size-4' />
    ) : metadata?.kind === 'ACCESS_REQUEST_DECIDED' ? (
      <LockKeyholeOpen className='size-4' />
    ) : (
      <CircleCheck className='size-4' />
    )

  return (
    <NotificationRow
      {...notification}
      subtitle={lead ? undefined : workflowName}
      icon={icon}
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
