// apps/web/src/components/kopilot/ui/blocks/entity-update-approval-card.tsx

'use client'

import { getDefinitionId } from '@auxx/lib/resources/client'
import { useRecord, useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'
import { KopilotFieldRow } from './kopilot-field-row'

export function EntityUpdateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const recordId = args.recordId as string
  const values = (args.values as Record<string, unknown>) ?? {}

  const { record } = useRecord({ recordId })
  const entityDefId = getDefinitionId(recordId)
  const { resource } = useResource(entityDefId)

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
      <div>
        {Object.entries(values).map(([key, value]) => (
          <KopilotFieldRow
            key={key}
            entityDefinitionId={entityDefId}
            fieldKey={key}
            value={value}
          />
        ))}
      </div>
    </BlockCard>
  )
}
