// apps/web/src/components/kopilot/ui/blocks/bulk-update-approval-card.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { getDefinitionId } from '@auxx/lib/resources/client'
import { useState } from 'react'
import { useResource } from '~/components/resources'
import type { ApprovalCardProps } from './approval-card-registry'
import { BlockCard, type BlockCardAction, StatusIndicator } from './block-card'
import { EntityCardItem } from './entity-card-item'

export function BulkUpdateApprovalCard({ args, status, onApprove, onReject }: ApprovalCardProps) {
  const recordIds = (args.recordIds ?? []) as RecordId[]
  const values = (args.values ?? []) as Array<{ fieldId: string; value: unknown }>
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(recordIds))

  const entityDefId = recordIds.length > 0 ? getDefinitionId(recordIds[0]) : null
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

  const changeSummary = values.map((v) => `${v.fieldId} → ${String(v.value)}`).join(', ')

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
      indicator={<StatusIndicator status={status} />}
      primaryText={`Update ${totalCount} ${resource?.plural ?? 'Records'}`}
      secondaryText={changeSummary}
      hasFooter={isPending}
      actionLabel={
        status === 'approved'
          ? `Updated ${totalCount}`
          : status === 'rejected'
            ? 'Rejected'
            : undefined
      }
      actions={actions}>
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
