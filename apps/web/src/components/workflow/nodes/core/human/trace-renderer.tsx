// apps/web/src/components/workflow/nodes/core/human/trace-renderer.tsx

'use client'

import { type ApprovalOutcome, isApprovalOutcome } from '@auxx/lib/approval-requests/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { UserCheck } from 'lucide-react'
import { BlockCard, StatusIndicator } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/**
 * `outputs` shape varies by phase (verified against
 * action-nodes/human-confirmation.ts + the three resume producers):
 * - Live, still paused: `{ approval_request_id, expires_at, assignee_count,
 *   notification_methods, requested_at }`.
 * - Live, resumed (approval-requests/registry.ts, approval-timeout-job.ts,
 *   cancelApprovalRequest): the paused fields above merged with the resume payload
 *   `{ outcome, approvalRequestId, respondedBy?, respondedAt?, comment?, timedOutAt?,
 *   cancelledBy?, cancelledAt?, cancelReason? }` and the five decision variables the
 *   engine derives from it.
 * - Test/dry-run mode (handleTestMode): `{ test_mode: true, test_behavior, … }` plus the
 *   same five decision variables.
 *
 * `outcome` is ONE vocabulary across every phase and producer — `ApprovalOutcome`
 * from `@auxx/lib/approval-requests/client`. It used to arrive as 'approve' | 'deny'
 * from the respond path, 'denied' from cancel and 'timeout' from the job, which is
 * why this file used to prefix-match it.
 */
interface HumanConfirmationOutputs {
  approval_request_id?: string
  approvalRequestId?: string
  expires_at?: string
  assignee_count?: number
  notification_methods?: { in_app?: boolean; email?: boolean }
  outcome?: string
  respondedBy?: string
  respondedAt?: string
  comment?: string
  timedOutAt?: string
  cancelledBy?: string
  cancelledAt?: string
  cancelReason?: string
  test_mode?: boolean
  test_behavior?: string
}

const OUTCOME_BADGES: Record<ApprovalOutcome, { label: string; variant: Variant }> = {
  approved: { label: 'Approved', variant: 'green' },
  denied: { label: 'Denied', variant: 'red' },
  timeout: { label: 'Timed out', variant: 'amber' },
}

/**
 * Preview for Human Confirmation node executions — a status dot + outcome
 * badge, assignee count and expiry while pending, and the responder/comment
 * (or timeout/cancel details) once resolved. A separate chip flags test-mode
 * runs, which report their own synthetic outcome.
 */
export function HumanConfirmationTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as HumanConfirmationOutputs

  const hasAnyKnownField =
    outputs.approval_request_id || outputs.approvalRequestId || outputs.outcome || outputs.test_mode
  if (!hasAnyKnownField) {
    return <TraceRawJson value={execution.outputs} />
  }

  const outcome = isApprovalOutcome(outputs.outcome) ? outputs.outcome : undefined
  const badge = outcome ? OUTCOME_BADGES[outcome] : undefined
  const indicatorStatus: 'pending' | 'approved' | 'rejected' =
    outcome === 'approved' ? 'approved' : outcome === 'denied' ? 'rejected' : 'pending'

  const expiresAt = outputs.expires_at
    ? new Date(outputs.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null
  const respondedAt = outputs.respondedAt
    ? new Date(outputs.respondedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <BlockCard
      data-slot='human-confirmation-trace-renderer'
      indicator={<StatusIndicator status={indicatorStatus} />}
      primaryText='Human Review'
      secondaryText={
        <span className='inline-flex items-center gap-1.5 text-xs'>
          {outputs.test_mode && <Badge variant='purple'>Test</Badge>}
          {badge ? (
            <Badge variant={badge.variant}>{badge.label}</Badge>
          ) : (
            <Badge variant='amber'>Pending</Badge>
          )}
        </span>
      }
      hasFooter={false}>
      <div className='space-y-1.5 p-1 text-sm'>
        {!outcome && (
          <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <UserCheck className='size-3' />
            {typeof outputs.assignee_count === 'number' && (
              <span>
                {outputs.assignee_count} assignee{outputs.assignee_count === 1 ? '' : 's'}
              </span>
            )}
            {expiresAt && <span>· expires {expiresAt}</span>}
          </div>
        )}
        {outcome === 'timeout' && (
          <div className='text-xs text-muted-foreground'>Expired without a response.</div>
        )}
        {(outputs.respondedBy || outputs.comment) && (
          <div className='text-xs text-muted-foreground'>
            {outputs.respondedBy && <span>By {outputs.respondedBy}</span>}
            {outputs.respondedBy && respondedAt && <span> · </span>}
            {respondedAt && <span>{respondedAt}</span>}
            {outputs.comment && <div className='mt-0.5 whitespace-pre-wrap'>{outputs.comment}</div>}
          </div>
        )}
        {outputs.cancelledBy && (
          <div className='text-xs text-muted-foreground'>
            Cancelled by {outputs.cancelledBy}
            {outputs.cancelReason && <div className='mt-0.5'>{outputs.cancelReason}</div>}
          </div>
        )}
      </div>
    </BlockCard>
  )
}
