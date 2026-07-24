// apps/web/src/components/fields/rows/field-edit-row.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { PanelField } from './types'

/**
 * Props for FieldEditRow
 */
interface FieldEditRowProps {
  /** Sortable id — the field's own id for custom fields, its key for system fields */
  id: string
  field: PanelField
  /** Whether this field can be reordered (custom fields only) */
  isSortable: boolean
  /** Composite `entityDefinitionId:fieldId`, used by the visibility toggle */
  resourceFieldId: string
  /** Whether the field is currently visible in the panel */
  isVisible: boolean
  /** Handler for editing the field definition (custom fields only) */
  onEdit?: (fieldId: string, field: PanelField) => void
  /** Handler for deleting the field definition (custom fields only) */
  onDelete?: (fieldId: string, fieldName: string) => void
  /** Handler for toggling field visibility */
  onToggleVisibility?: (resourceFieldId: string, visible: boolean) => void
}

/**
 * Edit-mode row: field definition administration only — no value is rendered and
 * the row is not clickable. Custom fields additionally get a drag handle and
 * edit/delete actions; system fields show just the name and visibility toggle.
 */
export const FieldEditRow = memo(function FieldEditRow({
  id,
  field,
  isSortable,
  resourceFieldId,
  isVisible,
  onEdit,
  onDelete,
  onToggleVisibility,
}: FieldEditRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !isSortable,
  })

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 10 : 1,
      opacity: isDragging ? 0.8 : 1,
    }),
    [transform, transition, isDragging]
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex w-full h-fit gap-1 min-h-[30px] items-center',
        isDragging && 'bg-accent rounded',
        !isVisible && 'opacity-50'
      )}>
      {isSortable ? (
        <div
          {...attributes}
          {...listeners}
          className='items-center self-start flex gap-[4px] h-[24px] shrink-0 cursor-grab active:cursor-grabbing'>
          <div className='shrink-0 size-6 flex items-center justify-center'>
            <GripVertical className='size-4 text-neutral-400 shrink-0' />
          </div>
          <div className='w-[120px] text-sm text-neutral-400 shrink-0'>
            <div className='truncate'>{field.name}</div>
          </div>
        </div>
      ) : (
        // Padded by the grip width so system field names line up with sortable ones
        <div className='w-[146px] pl-6 text-sm text-neutral-400 shrink-0'>
          <div className='truncate'>{field.name}</div>
        </div>
      )}

      {/* Spacer to push action buttons to the right */}
      <div className='flex-1' />

      <div className='flex items-center gap-1'>
        {onEdit && (
          <Button
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-foreground'
            onClick={() => onEdit(field.id, field)}>
            <Pencil />
          </Button>
        )}
        {onDelete && (
          <Button
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-destructive hover:bg-destructive/10'
            onClick={() => onDelete(field.id, field.name)}>
            <Trash2 />
          </Button>
        )}
        {onToggleVisibility && (
          <Switch
            checked={isVisible}
            size='sm'
            onCheckedChange={(checked) => onToggleVisibility(resourceFieldId, checked)}
          />
        )}
      </div>
    </div>
  )
})
