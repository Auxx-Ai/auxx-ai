// apps/web/src/components/global/notifications/ui/items/confirmation-row.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { AlertTriangle, ChevronRight, MoreHorizontal } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BlockCardActionButton, StatusIndicator } from '~/components/kopilot/ui/blocks/block-card'
import { useConfirm } from '~/hooks/use-confirm'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useNotificationPanelStore } from '../../notification-panel-store'
import { Emphasis } from '../notification-chips'
import { NotificationRow } from '../notification-row'

type PendingApprovalRequest = RouterOutputs['approval']['getPendingRequests'][number]

const TIMESTAMP_FORMAT = 'MMM d, yyyy h:mm a'

function formatTimestamp(value: Date | string | null | undefined): string {
  return value ? format(new Date(value), TIMESTAMP_FORMAT) : 'No expiration'
}

/**
 * A pending workflow human-confirmation, rendered inline in the Approvals tab.
 *
 * Absorbs the detail pane of the retired `HumanConfirmationDialog`: node, message,
 * timestamps and the decision comment all live in the drawer, which only fetches
 * `getApprovalDetails` once the row is first expanded. The footer stays anchored
 * above the drawer so Approve never slides out from under the cursor.
 */
export function ConfirmationRow({
  request,
  onResolved,
}: {
  request: PendingApprovalRequest
  onResolved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()
  const router = useRouter()
  const closePanel = useNotificationPanelStore((state) => state.close)

  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = api.approval.getApprovalDetails.useQuery(
    { id: request.id },
    // Lazy: nothing is fetched until the drawer is opened for the first time.
    { enabled: expanded, retry: false, refetchOnWindowFocus: false }
  )

  const approve = api.approval.approve.useMutation({
    onError: (error) => toastError({ title: 'Error approving', description: error.message }),
    onSettled: () => onResolved(),
  })

  const deny = api.approval.deny.useMutation({
    onError: (error) => toastError({ title: 'Error denying', description: error.message }),
    onSettled: () => onResolved(),
  })

  const isMutating = approve.isPending || deny.isPending
  const isExpired = request.expiresAt ? new Date(request.expiresAt) < new Date() : false
  const actionsDisabled = isMutating || isExpired

  const workflowName = request.workflowName || request.workflow?.name
  const trimmedComment = comment.trim()

  const handleApprove = () => {
    approve.mutate({ id: request.id, comment: trimmedComment || undefined })
  }

  const handleDeny = async () => {
    // Asymmetric on purpose: denying stops a live workflow run and there is no undo.
    const confirmed = await confirm({
      title: 'Deny this request?',
      description: 'This stops the workflow run. There is no way to undo it.',
      confirmText: 'Deny',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    deny.mutate({ id: request.id, comment: trimmedComment || undefined })
  }

  const openWorkflowRun = () => {
    router.push(`/app/workflows/${request.workflowId}?runId=${request.workflowRunId}`)
    closePanel()
  }

  const subtitle = isExpired ? (
    <span className='inline-flex items-center gap-1 text-destructive'>
      <AlertTriangle className='size-3 shrink-0' />
      This request has expired
    </span>
  ) : request.expiresAt ? (
    `Expires in ${formatDistanceToNowStrict(new Date(request.expiresAt))}`
  ) : undefined

  const drawer = (
    <div className='space-y-2 rounded-md bg-secondary/40 p-2'>
      {detailsLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-3 w-1/3' />
          <Skeleton className='h-10 w-full' />
        </div>
      ) : detailsError ? (
        <div className='flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive text-xs'>
          <AlertTriangle className='mt-px size-3.5 shrink-0' />
          <span>
            {detailsError.data?.code === 'FORBIDDEN'
              ? 'You are not authorized to view this approval request.'
              : detailsError.message}
          </span>
        </div>
      ) : (
        <>
          {details?.nodeName ? (
            <p className='text-muted-foreground text-xs'>
              Node <span className='text-foreground'>{details.nodeName}</span>
            </p>
          ) : null}
          {(details?.message ?? request.message) ? (
            <p className='text-sm leading-6'>{details?.message ?? request.message}</p>
          ) : null}
        </>
      )}

      <dl className='grid grid-cols-2 gap-2 text-xs'>
        <div>
          <dt className='text-muted-foreground'>Created</dt>
          <dd className='font-medium'>{formatTimestamp(request.createdAt)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>Expires</dt>
          <dd className={cn('font-medium', isExpired && 'text-destructive')}>
            {formatTimestamp(request.expiresAt)}
          </dd>
        </div>
      </dl>

      <div>
        <label
          htmlFor={`confirmation-comment-${request.id}`}
          className='text-muted-foreground text-xs'>
          Comment (optional)
        </label>
        <Textarea
          id={`confirmation-comment-${request.id}`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder='Add a comment about your decision...'
          rows={2}
          disabled={isMutating}
          className='mt-1 text-sm'
        />
      </div>
    </div>
  )

  return (
    <>
      <NotificationRow
        id={request.id}
        createdAt={request.createdAt}
        // The body carries the "Approval required" lead — the header names the kind.
        label='Workflow'
        icon={<StatusIndicator status='pending' />}
        subtitle={subtitle}
        actionLabel={
          <button
            type='button'
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className='flex h-7 cursor-pointer items-center gap-1 rounded-full pr-2 text-foreground/65 text-xs font-medium hover:bg-foreground/5'>
            <ChevronRight
              className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
              aria-hidden
            />
            {expanded ? 'Hide details' : 'Details'}
          </button>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* size-7 + rounded-full so the trigger sits level with the h-7 pills. */}
                <Button
                  variant='ghost'
                  size='icon-sm'
                  className='size-7 rounded-full'
                  aria-label='Confirmation actions'>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-48'>
                <DropdownMenuItem onClick={openWorkflowRun}>Open workflow run</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <BlockCardActionButton
              label='Deny'
              destructive
              disabled={actionsDisabled}
              onClick={() => void handleDeny()}
            />
            <BlockCardActionButton
              label='Approve'
              primary
              disabled={actionsDisabled}
              onClick={handleApprove}
            />
          </>
        }
        expanded={
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
                animate={{ height: 'auto', opacity: 1, filter: 'blur(0px)' }}
                exit={{ height: 0, opacity: 0, filter: 'blur(3px)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ overflow: 'hidden' }}>
                <div className='pt-2'>{drawer}</div>
              </motion.div>
            )}
          </AnimatePresence>
        }>
        Approval required
        {workflowName ? (
          <>
            {' '}
            for <Emphasis>{workflowName}</Emphasis>
          </>
        ) : null}
      </NotificationRow>

      <ConfirmDialog />
    </>
  )
}
