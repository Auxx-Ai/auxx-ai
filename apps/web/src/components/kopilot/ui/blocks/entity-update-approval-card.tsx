// apps/web/src/components/kopilot/ui/blocks/entity-update-approval-card.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { useRecord, useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

export function EntityUpdateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const recordId = args.recordId as string
  const values = (args.values as Record<string, unknown>) ?? {}

  const { record } = useRecord({ recordId })
  const entityDefId = getDefinitionId(recordId)
  const { resource } = useResource(entityDefId)

  const fieldEntries = Object.entries(values).map(([key, value]) => {
    const field = resource?.fields?.find((f) => (f.systemAttribute ?? f.key) === key)
    return { key, label: field?.label ?? key, value }
  })

  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Approve', onClick: () => onApprove(), primary: true },
      ]
    : []

  return (
    <BlockCard
      data-slot='entity-update-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText={`Update ${resource?.label ?? 'Record'}${record?.displayName ? `: ${record.displayName}` : ''}`}
      hasFooter={isPending}
      actionLabel={isPending ? 'Apply changes?' : undefined}
      actions={actions}>
      <div className='space-y-1.5'>
        {fieldEntries.map(({ key, label, value }) => (
          <div key={key} className='flex items-baseline gap-2 text-sm'>
            <span className='shrink-0 text-xs text-muted-foreground'>{label}:</span>
            <span className='truncate font-medium'>{String(value ?? '')}</span>
          </div>
        ))}
      </div>
    </BlockCard>
  )
}
