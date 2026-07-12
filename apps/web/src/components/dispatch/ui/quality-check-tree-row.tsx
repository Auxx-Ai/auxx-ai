// apps/web/src/components/dispatch/ui/quality-check-tree-row.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Power, PowerOff } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'

export type QcItemTemplateRow = RouterOutputs['dispatch']['listQcTemplates'][number]

interface QualityCheckTreeRowProps {
  template: QcItemTemplateRow
  isSelected: boolean
  onSelect: () => void
  onToggleActive: () => void
  isPending: boolean
}

/**
 * One QC template row in the settings tree list (08-worker-surface.md §5) — draggable via
 * dnd-kit `useSortable` (the drag handle doubles as the row's leading icon); selecting it opens
 * the FieldPanel editor. The only row-level action is deactivate/reactivate — templates are
 * never deleted, so there is no destructive `TreeRowButton` here.
 */
export function QualityCheckTreeRow({
  template,
  isSelected,
  onSelect,
  onToggleActive,
  isPending,
}: QualityCheckTreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: template.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <TreeRow
        icon={
          <span {...attributes} {...listeners} className='cursor-grab touch-none'>
            <GripVertical className='size-4' />
          </span>
        }
        isOpen={isSelected}
        onToggleOpen={onSelect}
        rowClassName={cn(
          isSelected ? 'bg-primary-100 hover:bg-primary-150' : 'bg-primary-50 hover:bg-primary-100',
          !template.isActive && 'opacity-60'
        )}
        title={<span className='text-sm'>{template.title}</span>}
        actions={
          <div className='flex items-center gap-1.5'>
            {template.isRequired && (
              <Badge variant='secondary' size='sm'>
                Required
              </Badge>
            )}
            {!template.isActive && (
              <Badge variant='outline' size='sm'>
                Inactive
              </Badge>
            )}
            <TreeRowButton
              tooltipText={template.isActive ? 'Deactivate' : 'Reactivate'}
              disabled={isPending}
              onClick={onToggleActive}>
              {template.isActive ? <PowerOff /> : <Power />}
            </TreeRowButton>
          </div>
        }
      />
    </div>
  )
}
