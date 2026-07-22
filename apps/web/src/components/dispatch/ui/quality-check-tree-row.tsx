// apps/web/src/components/dispatch/ui/quality-check-tree-row.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Switch } from '@auxx/ui/components/switch'
import { SortableTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Trash2 } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'

export type QcItemTemplateRow = RouterOutputs['dispatch']['listQcTemplates'][number]

interface QualityCheckTreeRowProps {
  template: QcItemTemplateRow
  isSelected: boolean
  onSelect: () => void
  onToggleActive: () => void
  onDelete: () => void
  isPending: boolean
}

/**
 * One QC template row in the settings tree list (08-worker-surface.md §5), styled to match the
 * Products & Services lists — a `SortableTreeRow` (hover-revealed drag grip in the leading slot);
 * selecting it opens the FieldPanel editor. Trailing actions mirror products-list.tsx: a
 * destructive delete button (already-materialized visit checklists keep their snapshot rows)
 * and the active/inactive `Switch`.
 */
export function QualityCheckTreeRow({
  template,
  isSelected,
  onSelect,
  onToggleActive,
  onDelete,
  isPending,
}: QualityCheckTreeRowProps) {
  return (
    <SortableTreeRow
      id={template.id}
      isOpen={isSelected}
      onToggleOpen={onSelect}
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        isSelected && 'bg-primary-100 ring-1 ring-primary-200',
        !template.isActive && 'opacity-60'
      )}
      title={<span className='text-sm'>{template.title}</span>}
      secondary={
        template.isRequired ? (
          <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
            <Badge variant='secondary' size='xs'>
              Required
            </Badge>
          </span>
        ) : undefined
      }
      actions={
        <div className='flex items-center gap-1'>
          <TreeRowButton tooltipText='Delete check' variant='destructive' onClick={onDelete}>
            <Trash2 />
          </TreeRowButton>
          <Switch
            size='xs'
            checked={template.isActive}
            onCheckedChange={onToggleActive}
            disabled={isPending}
          />
        </div>
      }
    />
  )
}
