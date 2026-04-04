// apps/web/src/components/kopilot/ui/blocks/generic-approval-card.tsx

'use client'

import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

export function GenericApprovalCard({
  toolName,
  args,
  status,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Reject', onClick: onReject },
        { label: 'Approve', onClick: () => onApprove(), primary: true },
      ]
    : []

  const argEntries = Object.entries(args).slice(0, 5)

  return (
    <BlockCard
      indicator={<StatusIndicator status={status} />}
      primaryText='Approval required'
      secondaryText={<span className='font-mono text-xs'>{toolName}</span>}
      hasFooter={isPending}
      actions={actions}>
      {argEntries.length > 0 && (
        <div className='space-y-1.5'>
          {argEntries.map(([key, value]) => {
            const str = typeof value === 'string' ? value : JSON.stringify(value)
            return (
              <div key={key} className='flex items-baseline gap-2 text-sm'>
                <span className='shrink-0 text-xs text-muted-foreground'>{key}:</span>
                <span className='truncate font-medium'>
                  {str.length > 80 ? `${str.slice(0, 80)}...` : str}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </BlockCard>
  )
}
