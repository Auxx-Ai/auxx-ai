// apps/web/src/components/accounting/ui/ledger/outbox/export-batch-badge.tsx

'use client'

// The batch state badge, shared by the queue's own rows, the posting drawer's
// Export section and `ledger-card.tsx` - one state vocabulary, one look,
// wherever it renders (TARGET §3, §4 gate 2).

import {
  type ExportBatchState,
  type ExportFailureClass,
  exportBatchStateHint,
  exportBatchStateLabel,
  exportFailureClassHint,
  type SummaryRowStatus,
} from '@auxx/lib/accounting/export/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'

const EXPORT_BATCH_STATE_VARIANT: Record<ExportBatchState, Variant> = {
  ready: 'outline',
  sending: 'blue',
  sent: 'green',
  failed: 'destructive',
  withdrawn: 'outline',
}

interface ExportBatchStateBadgeProps {
  state: ExportBatchState
  /** Only `ready`'s hint depends on it - see `exportBatchStateHint`. */
  autoSend?: boolean
  /** The last refusal's class (89 D6). Says WHAT KIND on `failed`; the state stays the state. */
  failureClass?: ExportFailureClass | null
  size?: 'xs' | 'sm' | 'default'
}

export function ExportBatchStateBadge({
  state,
  autoSend = false,
  failureClass = null,
  size = 'xs',
}: ExportBatchStateBadgeProps) {
  const hint =
    (state === 'failed' ? exportFailureClassHint(failureClass) : null) ??
    exportBatchStateHint(state, autoSend)
  const badge = (
    <Badge variant={EXPORT_BATCH_STATE_VARIANT[state]} size={size}>
      {exportBatchStateLabel(state)}
    </Badge>
  )
  return hint ? <SimpleTooltip content={hint}>{badge}</SimpleTooltip> : badge
}

interface SummaryStatusBadgeProps {
  status: SummaryRowStatus
  newCount: number
  failureClass?: ExportFailureClass | null
  autoSend?: boolean
}

/** A Summary row's status (95 §3.2): the batch state, `Not sent` without one, plus `n new` since it was built. */
export function SummaryStatusBadge({
  status,
  newCount,
  failureClass = null,
  autoSend = false,
}: SummaryStatusBadgeProps) {
  if (status === 'not_sent')
    return (
      <SimpleTooltip content='No batch holds these postings yet; Send builds and sends it'>
        <Badge variant='outline' size='xs'>
          Not sent
        </Badge>
      </SimpleTooltip>
    )
  const state: ExportBatchState =
    status === 'ready_new' ? 'ready' : status === 'sent_new' ? 'sent' : status
  return (
    <span className='flex items-center gap-1'>
      <ExportBatchStateBadge state={state} failureClass={failureClass} autoSend={autoSend} />
      {(status === 'ready_new' || status === 'sent_new') && (
        <Badge variant='blue' size='xs'>
          {newCount} new
        </Badge>
      )}
    </span>
  )
}
