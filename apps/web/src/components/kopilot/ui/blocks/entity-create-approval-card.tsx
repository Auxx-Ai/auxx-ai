// apps/web/src/components/kopilot/ui/blocks/entity-create-approval-card.tsx

'use client'

import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'

/** Convert camelCase field keys to human-readable labels (e.g. "companyName" -> "Company Name") */
function formatFieldKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

export function EntityCreateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const entityDefinitionId = args.entityDefinitionId as string

  const values =
    (args.values as Record<string, unknown>) ??
    Object.fromEntries(
      Object.entries(args).filter(([k]) => k !== 'entityDefinitionId' && k !== 'values')
    )

  const { resource } = useResource(entityDefinitionId)

  const fieldEntries = Object.entries(values)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => {
      const field = resource?.fields?.find((f) => (f.systemAttribute ?? f.key) === key)
      return { key, label: field?.label ?? formatFieldKey(key), value }
    })

  const isPending = status === 'pending'

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        { label: 'Create', onClick: () => onApprove(), primary: true },
      ]
    : []

  return (
    <BlockCard
      indicator={<StatusIndicator status={status} />}
      primaryText={`Create ${resource?.label ?? 'Record'}`}
      hasFooter={isPending}
      actionLabel={isPending ? 'Create record?' : undefined}
      actions={actions}>
      {fieldEntries.length > 0 ? (
        <div className='space-y-1.5'>
          {fieldEntries.map(({ key, label, value }) => (
            <div key={key} className='flex items-baseline gap-2 text-sm'>
              <span className='shrink-0 text-xs text-muted-foreground'>{label}:</span>
              <span className='truncate font-medium'>{String(value ?? '')}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className='text-xs text-muted-foreground'>No fields specified</p>
      )}
    </BlockCard>
  )
}
