// apps/web/src/components/kopilot/ui/blocks/entity-create-approval-card.tsx

'use client'

import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'
import { KopilotFieldRow } from './kopilot-field-row'

export function EntityCreateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const entityDefinitionId = args.entityDefinitionId as string

  const values =
    (args.values as Record<string, unknown>) ??
    Object.fromEntries(
      Object.entries(args).filter(([k]) => k !== 'entityDefinitionId' && k !== 'values')
    )

  const { resource } = useResource(entityDefinitionId)

  const entries = Object.entries(values).filter(([, value]) => value != null && value !== '')

  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Create', onClick: () => onApprove(), primary: true },
      ]
    : []

  return (
    <BlockCard
      data-slot='entity-create-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText={`Create ${resource?.label ?? 'Record'}`}
      hasFooter={isPending}
      actionLabel={isPending ? 'Create record?' : undefined}
      actions={actions}>
      {entries.length > 0 ? (
        <div>
          {entries.map(([key, value]) => (
            <KopilotFieldRow
              key={key}
              entityDefinitionId={entityDefinitionId}
              fieldKey={key}
              value={value}
            />
          ))}
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>No fields specified</p>
      )}
    </BlockCard>
  )
}
