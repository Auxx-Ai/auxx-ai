// apps/web/src/components/workflow/nodes/core/human/trace-renderer.tsx

'use client'

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { UserCheck } from 'lucide-react'
import { BlockCard, StatusIndicator } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/**
 * `outputs` shape varies by phase (verified against
 * action-nodes/human-confirmation.ts + the resume-side services):
 * - Live, still paused: `{ approval_request_id, expires_at, assignee_count, notification_methods }`.
 * - Live, resumed (approval-response-service.ts / approval-timeout-job.ts): the paused
 *   fields above merged with `{ outcome, approvalRequestId, respondedBy?, respondedAt?,
 *   comment?, timedOutAt?, cancelledBy?, cancelledAt?, cancelReason? }`. `outcome` is an
 *   unnormalized string across call sites: 'approve' | 'deny' (respond), 'denied' (cancel),
 *   'timeout' (timeout job).
 * - Test/dry-run mode (handleTestMode): `{ test_mode: true, outcome: 'approved' | 'denied'
 *   | 'timeout', test_behavior }`.
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

type Outcome = 'approved' | 'denied' | 'timeout'

/** Normalize the inconsistent `outcome` casing across call sites (see above). */
function normalizeOutcome(raw?: string): Outcome | undefined {
  if (!raw) return undefined
  if (raw.startsWith('approv')) return 'approved'
  if (raw.startsWith('den')) return 'denied'
  if (raw === 'timeout') return 'timeout'
  return undefined
}

const OUTCOME_BADGES: Record<Outcome, { label: string; variant: Variant }> = {
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

  const outcome = normalizeOutcome(outputs.outcome)
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
