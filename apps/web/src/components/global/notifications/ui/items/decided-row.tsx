// apps/web/src/components/global/notifications/ui/items/decided-row.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { Emphasis } from '../notification-chips'
import { NotificationRow } from '../notification-row'

type PastApprovalRequest = RouterOutputs['approval']['list']['items'][number]

const TIMESTAMP_FORMAT = 'MMM d, yyyy h:mm a'

function formatTimestamp(value: Date | string | null | undefined): string {
  return value ? format(new Date(value), TIMESTAMP_FORMAT) : '—'
}

/**
 * How each terminal state reads. `pending` is in the list because the `past` view
 * is the complement of "still actionable", not a status list — an access request
 * whose expiry lapsed is never rewritten to `timeout`, so it arrives here still
 * marked pending and must not render as if it were awaiting a decision.
 */
const OUTCOMES = {
  approved: { label: 'Approved', dot: 'bg-emerald-500', tone: 'text-emerald-600' },
  denied: { label: 'Denied', dot: 'bg-red-500', tone: 'text-destructive' },
  timeout: { label: 'Expired', dot: 'bg-muted-foreground/50', tone: 'text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', dot: 'bg-muted-foreground/50', tone: 'text-muted-foreground' },
  superseded: { label: 'Superseded', dot: 'bg-muted-foreground/50', tone: 'text-muted-foreground' },
  pending: { label: 'Expired', dot: 'bg-muted-foreground/50', tone: 'text-muted-foreground' },
} as const

function outcomeOf(status: string) {
  return OUTCOMES[status as keyof typeof OUTCOMES] ?? OUTCOMES.superseded
}

/**
 * One decided approval, read-only, in the Approvals tab's Past view.
 *
 * A separate component rather than a `readOnly` mode of `ConfirmationRow` /
 * `AccessRequestRow`: those two are decision surfaces down to their structure —
 * comment box, confirm dialog, two mutations, expiry countdown — and none of it
 * survives the decision. What a past row leads with is the opposite: the outcome,
 * who reached it, and when. Both kinds share this one row because at that point
 * the difference between them is a noun in the sentence.
 */
export function DecidedRow({ request }: { request: PastApprovalRequest }) {
  const [expanded, setExpanded] = useState(false)
  const outcome = outcomeOf(request.status)

  // Lazy, and the same query the pending rows use — `getApprovalDetails` gates on
  // `canUserViewApproval`, which deliberately keeps admitting a request once it
  // goes terminal.
  const {
    data: details,
    isLoading: detailsLoading,
    error: detailsError,
  } = api.approval.getApprovalDetails.useQuery(
    { id: request.id },
    { enabled: expanded, retry: false, refetchOnWindowFocus: false }
  )

  // Live-join-wins, as on the pending rows: the joined workflow name is the truth
  // when this reader can hydrate it, and `subjectLabel` is the fallback and the
  // durability guarantee — which is the whole point on a denied access row, whose
  // requester never got the access needed to resolve the target.
  const subjectLabel = request.workflow?.name || request.subjectLabel
  const decidedBy = request.decision?.by?.name
  const decidedAt = request.decision?.respondedAt

  const subtitle = (
    <span className={cn('inline-flex items-center gap-1.5', outcome.tone)}>
      <span className={cn('size-2 shrink-0 rounded-full', outcome.dot)} />
      {outcome.label}
      {decidedBy ? ` by ${decidedBy}` : ''}
      <span className='text-muted-foreground'>
        · {formatDistanceToNowStrict(new Date(decidedAt ?? request.createdAt), { addSuffix: true })}
      </span>
    </span>
  )

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
          <dt className='text-muted-foreground'>Requested</dt>
          <dd className='font-medium'>{formatTimestamp(request.createdAt)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>{outcome.label}</dt>
          {/* Only approve/deny write an `ApprovalResponse`, so a withdrawn,
              timed-out or lapsed row has no decision timestamp to show. */}
          <dd className='font-medium'>{decidedAt ? formatTimestamp(decidedAt) : '—'}</dd>
        </div>
      </dl>

      {request.decision?.comment ? (
        <div>
          <p className='text-muted-foreground text-xs'>Comment</p>
          <p className='mt-1 text-sm leading-6'>{request.decision.comment}</p>
        </div>
      ) : null}
    </div>
  )

  return (
    <NotificationRow
      id={request.id}
      createdAt={request.createdAt}
      label={request.kind === 'access' ? 'Access' : 'Workflow'}
      icon={<span className={cn('size-2 rounded-full', outcome.dot)} />}
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
      {request.kind === 'access' ? (
        <>
          <Emphasis>{request.requester?.name ?? 'A member'}</Emphasis> requested access
          {subjectLabel ? (
            <>
              {' '}
              to <Emphasis>{subjectLabel}</Emphasis>
            </>
          ) : null}
        </>
      ) : (
        <>
          Approval
          {subjectLabel ? (
            <>
              {' '}
              for <Emphasis>{subjectLabel}</Emphasis>
            </>
          ) : null}
        </>
      )}
    </NotificationRow>
  )
}
