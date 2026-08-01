// apps/web/src/components/kopilot/ui/blocks/bulk-update-approval-card.tsx

'use client'

import { getDefinitionId, isRecordId } from '@auxx/lib/resources/client'
import { useState } from 'react'
import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'
import { EntityCardItem } from './entity-card-item'
import { KopilotFieldRow } from './kopilot-field-row'

export function BulkUpdateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  // Approval-card args are raw model output — only required-key presence is
  // checked before the card renders, so a wrong-typed `recordIds` would throw
  // in `getDefinitionId` and a non-array `values` in `.map`.
  const recordIds = (Array.isArray(args.recordIds) ? args.recordIds : []).filter(isRecordId)
  const values = (Array.isArray(args.values) ? args.values : []) as Array<{
    fieldId: string
    value: unknown
  }>
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(recordIds))

  const firstRecordId = recordIds[0]
  const entityDefId = firstRecordId ? getDefinitionId(firstRecordId) : null
  const { resource } = useResource(entityDefId)

  const selectedCount = selectedIds.size
  const totalCount = recordIds.length
  const isPending = status === 'pending'

  const toggleRecord = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(recordIds))
  const deselectAll = () => setSelectedIds(new Set())

  const actions: BlockCardAction[] = isPending
    ? [
        { label: 'Deny', onClick: onReject },
        {
          label: `Approve ${selectedCount} of ${totalCount}`,
          onClick: () => onApprove({ _approvedRecordIds: Array.from(selectedIds) }),
          primary: true,
        },
      ]
    : []

  return (
    <BlockCard
      data-slot='bulk-update-approval-card'
      indicator={<StatusIndicator status={status} />}
      primaryText={`Update ${totalCount} ${resource?.plural ?? 'Records'}`}
      hasFooter={isPending}
      actionLabel={
        status === 'approved'
          ? `Updated ${totalCount}`
          : status === 'rejected'
            ? 'Rejected'
            : undefined
      }
      actions={actions}
      collapsible={status === 'rejected'}
      defaultCollapsed={status === 'rejected'}>
      {values.length > 0 && (
        <div className='mb-2 border-b pb-2'>
          {values.map((v) => (
            <KopilotFieldRow
              key={v.fieldId}
              entityDefinitionId={entityDefId}
              fieldKey={v.fieldId}
              value={v.value}
            />
          ))}
        </div>
      )}

      <div className='space-y-1'>
        {isPending && totalCount > 2 && (
          <div className='flex gap-2 px-1 pb-1'>
            <button
              type='button'
              className='text-xs text-muted-foreground hover:text-foreground'
              onClick={selectAll}>
              Select all
            </button>
            <span className='text-xs text-muted-foreground'>·</span>
            <button
              type='button'
              className='text-xs text-muted-foreground hover:text-foreground'
              onClick={deselectAll}>
              Deselect all
            </button>
          </div>
        )}

        {recordIds.map((recordId) => (
          <EntityCardItem
            key={recordId}
            recordId={recordId}
            selectable={
              isPending
                ? {
                    checked: selectedIds.has(recordId),
                    onChange: (checked) => toggleRecord(recordId, checked),
                  }
                : undefined
            }
          />
        ))}
      </div>
    </BlockCard>
  )
}
