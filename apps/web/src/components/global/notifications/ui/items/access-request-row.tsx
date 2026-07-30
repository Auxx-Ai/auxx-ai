// apps/web/src/components/global/notifications/ui/items/access-request-row.tsx
'use client'

import { ACCESS_DENY_COOLDOWN_DAYS } from '@auxx/lib/approval-requests/client'
import { LENS_LABELS, RUNG_LABELS } from '@auxx/lib/permissions/visibility/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { AlertTriangle, ChevronRight, LockKeyhole } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { BlockCardActionButton } from '~/components/kopilot/ui/blocks/block-card'
import { useConfirm } from '~/hooks/use-confirm'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { Emphasis } from '../notification-chips'
import { NotificationRow } from '../notification-row'

type PendingApprovalRequest = RouterOutputs['approval']['getPendingRequests'][number]

const TIMESTAMP_FORMAT = 'MMM d, yyyy h:mm a'

function formatTimestamp(value: Date | string | null | undefined): string {
  return value ? format(new Date(value), TIMESTAMP_FORMAT) : 'No expiration'
}

/**
 * A pending ACCESS request, rendered inline in the Approvals tab beside
 * `ConfirmationRow` (plan 42 §7).
 *
 * A sibling rather than a mode of `ConfirmationRow`: the payload is *who · what ·
 * what level* instead of *which workflow*, denying costs a teammate access rather
 * than killing a live run, and the label is lens-gated. What is shared is the row
 * chrome and the progressive-disclosure comment — the same pattern the requester
 * side uses for its note.
 *
 * **Most requests carry no note** (§0.3), so the collapsed row must read completely
 * on its own. `requester` and `subjectLabel` both ship on the pending list for that
 * reason; the drawer adds only what needs the approver's own lens.
 */
export function AccessRequestRow({
  request,
  onResolved,
}: {
  request: PendingApprovalRequest
  onResolved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [confirm, ConfirmDialog] = useConfirm()

  /**
   * Lazy, and deliberately a SEPARATE query from `getApprovalDetails`: the
   * hydration decision needs this approver's own mail lens on the target, which the
   * generic details do not compute (and should not pay for on a workflow row).
   */
  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = api.approval.accessRequestDetails.useQuery(
    { id: request.id },
    { enabled: expanded, retry: false, refetchOnWindowFocus: false }
  )

  const approve = api.approval.approve.useMutation({
    onError: (error) => toastError({ title: 'Error granting access', description: error.message }),
    onSettled: () => onResolved(),
  })

  const deny = api.approval.deny.useMutation({
    onError: (error) => toastError({ title: 'Error declining', description: error.message }),
    onSettled: () => onResolved(),
  })

  const isMutating = approve.isPending || deny.isPending
  const isExpired = request.expiresAt ? new Date(request.expiresAt) < new Date() : false
  // A target that has since been deleted or moved org would be refused by the
  // decision handler (§4.2 step 1), so do not offer the click.
  const targetGone = details?.targetAvailable === false
  const actionsDisabled = isMutating || isExpired || targetGone

  const requesterName = request.requester?.name ?? 'A teammate'
  /**
   * **Labels are chosen per LANE, because `read` means different things in each.**
   *
   * `read` is the TOP of mail's ladder (`Lens = metadata | identity | read`), so
   * mail calls it "Full access". It is the BOTTOM of the record ladder
   * (`RECORD_DEF_RUNGS = none | read | edit | admin`), where "Full access" would
   * describe the ask as the widest in the system when it is the narrowest. One
   * shared map cannot be right for both — reading every row through `RUNG_LABELS`
   * silently reworded every existing mail request from "full access" to "read
   * access".
   *
   * The discriminator is the persisted `entityDefinitionId`: the thread lane
   * writes the literal slug `'thread'` (never a CUID — that keyspace guarantee is
   * plan 42 §2.3), so anything else is a record def.
   *
   * `?? 'read'` covers only a NULL column, which is what an area/def target
   * leaves behind. Neither map needs a miss fallback: `RUNG_LABELS` is total over
   * `Rung`, so an unhandled rung is a compile error rather than a wrong string.
   */
  const isThreadLane = request.entityDefinitionId === 'thread'
  const requestedRung = request.requestedLens ?? 'read'
  const levelLabel = (
    isThreadLane && requestedRung in LENS_LABELS
      ? LENS_LABELS[requestedRung as keyof typeof LENS_LABELS].label
      : RUNG_LABELS[requestedRung]
  ).toLowerCase()
  const trimmedComment = comment.trim()

  const handleApprove = () => {
    approve.mutate({ id: request.id, comment: trimmedComment || undefined })
  }

  const handleDeny = async () => {
    const confirmed = await confirm({
      title: 'Decline this request?',
      description: `${requesterName} keeps their current access and cannot ask again for ${ACCESS_DENY_COOLDOWN_DAYS} days.`,
      confirmText: 'Decline',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return
    deny.mutate({ id: request.id, comment: trimmedComment || undefined })
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
          <Skeleton className='h-3 w-2/3' />
        </div>
      ) : detailsError ? (
        <div className='flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive text-xs'>
          <AlertTriangle className='mt-px size-3.5 shrink-0' />
          <span>
            {detailsError.data?.code === 'FORBIDDEN'
              ? 'You are not authorized to view this access request.'
              : detailsError.message}
          </span>
        </div>
      ) : details ? (
        <>
          <p className='text-muted-foreground text-xs'>
            Conversation <span className='text-foreground'>{details.label}</span>
          </p>
          {/* §7's hydration rule, said out loud. Sharing authority and a reading
              lens are different things: a downgraded admin or one deciding a
              null-inbox request may be allowed to approve while unable to read the
              conversation, and the row must show the durable snapshot rather than
              quietly implying it is live. */}
          {details.targetAvailable && !details.hydrated ? (
            <p className='text-muted-foreground text-xs'>
              You have {LENS_LABELS[details.approverLens]?.label.toLowerCase()} here, so this is the
              summary captured when the request was filed.
            </p>
          ) : null}
          {!details.targetAvailable ? (
            <p className='flex items-center gap-1.5 text-destructive text-xs'>
              <AlertTriangle className='size-3 shrink-0' />
              This conversation is no longer available.
            </p>
          ) : null}
          <p className='text-muted-foreground text-xs'>
            {requesterName} has{' '}
            <span className='text-foreground'>
              {LENS_LABELS[details.requesterLens]?.label.toLowerCase() ?? 'no access'}
            </span>{' '}
            today
            {details.remindCount > 0 ? ` · asked ${details.remindCount + 1} times` : ''}
          </p>
        </>
      ) : null}

      {request.message ? <p className='text-sm leading-6'>{request.message}</p> : null}

      <dl className='grid grid-cols-2 gap-2 text-xs'>
        <div>
          <dt className='text-muted-foreground'>Requested</dt>
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
        <label htmlFor={`access-comment-${request.id}`} className='text-muted-foreground text-xs'>
          Comment (optional)
        </label>
        <Textarea
          id={`access-comment-${request.id}`}
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
        label='Access'
        icon={<LockKeyhole className='size-4' />}
        subtitle={subtitle}
        actionLabel={
          <button
            type='button'
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className='flex h-7 cursor-pointer items-center gap-1 rounded-full pr-2 font-medium text-foreground/65 text-xs hover:bg-foreground/5'>
            <ChevronRight
              className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
              aria-hidden
            />
            {expanded ? 'Hide details' : 'Details'}
          </button>
        }
        actions={
          <>
            <BlockCardActionButton
              label='Decline'
              destructive
              disabled={actionsDisabled}
              onClick={() => void handleDeny()}
            />
            <BlockCardActionButton
              label='Grant'
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
        <Emphasis>{requesterName}</Emphasis> asked for {levelLabel} to{' '}
        <Emphasis>{request.subjectLabel}</Emphasis>
      </NotificationRow>

      <ConfirmDialog />
    </>
  )
}
