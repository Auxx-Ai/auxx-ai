// apps/web/src/components/fields/rows/field-edit-row.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import type { PanelField } from './types'

/**
 * The field's own icon with the drag grip cross-fading over it — the grip
 * appears on row hover or while dragging, which is how every other sortable row
 * in the app behaves (`TreeRow`, `packages/ui/src/components/tree-row.tsx`).
 * The icon matches what the read-mode `PropertyRow` shows for the same field,
 * so entering edit mode does not reshuffle the row's leading column.
 *
 * On a COARSE pointer the grip is always visible and the icon never shows:
 * Tailwind wraps `hover:` in `@media (hover: hover)`, so a hover-revealed handle
 * is simply unreachable on touch. `pointer-fine:` is the codebase's variant for
 * this split (see `global/forms/field-panel.tsx`).
 */
function DragIcon({
  iconId,
  isDragging,
  handleProps,
}: {
  iconId: string
  isDragging: boolean
  handleProps?: Record<string, unknown>
}) {
  return (
    <span className='relative flex size-6 shrink-0 items-center justify-center'>
      <span
        className={cn(
          'flex items-center justify-center opacity-0 transition-opacity pointer-fine:opacity-100',
          isDragging
            ? 'pointer-fine:opacity-0'
            : 'pointer-fine:group-hover/field-edit-row:opacity-0'
        )}>
        <EntityIcon iconId={iconId} variant='default' size='default' className='text-neutral-400' />
      </span>
      {handleProps && (
        <span
          {...handleProps}
          className={cn(
            'absolute inset-0 flex cursor-grab touch-none items-center justify-center opacity-100 transition-opacity pointer-fine:opacity-0 active:cursor-grabbing',
            isDragging
              ? 'pointer-fine:opacity-100'
              : 'pointer-fine:group-hover/field-edit-row:opacity-100'
          )}>
          <GripVertical className='size-4 shrink-0 text-neutral-400' />
        </span>
      )}
    </span>
  )
}

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

  // Same resolution `PropertyRow` uses, so read and edit mode show one icon.
  const iconId = field.icon ?? fieldTypeOptions[field.fieldType as FieldType]?.iconId ?? 'circle'

  // The row FADES IN PLACE — it is not displaced and it does not follow the
  // pointer. There is no `SortableContext` around this row (see
  // `entity-fields-content`), so `useSortable` never resolves a transform;
  // position feedback comes from the insert line and the group highlight
  // instead. 0.3 is the KB sidebar's value for the same "this is the thing in
  // hand" state, and no accent fill: a filled row competes with the highlight
  // drawn across the group it is about to join.
  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 10 : 1,
      opacity: isDragging ? 0.3 : 1,
    }),
    [transform, transition, isDragging]
  )

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/field-edit-row flex w-full h-fit gap-1 min-h-[30px] items-center',
        !isVisible && 'opacity-50'
      )}>
      {/* Every field is sortable now that order lives in the view config, but
          `isSortable` is still honoured: an unsortable row shows the icon with
          no grip behind it rather than a dead handle. */}
      <div className='items-center self-start flex gap-[4px] h-[24px] shrink-0'>
        <DragIcon
          iconId={iconId}
          isDragging={isDragging}
          handleProps={isSortable ? { ...attributes, ...listeners } : undefined}
        />
        <div className='w-[120px] text-sm text-neutral-400 shrink-0'>
          <div className='truncate'>{field.name}</div>
        </div>
      </div>

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
            size='xs'
            onCheckedChange={(checked) => onToggleVisibility(resourceFieldId, checked)}
          />
        )}
      </div>
    </div>
  )
})
