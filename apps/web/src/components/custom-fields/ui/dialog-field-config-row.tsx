// apps/web/src/components/custom-fields/ui/dialog-field-config-row.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import { memo } from 'react'

/** Props for DialogFieldConfigRow */
interface DialogFieldConfigRowProps {
  /** Unique ID for the sortable item — the VIEW field id, which is every dnd id */
  id: string
  /** Display label for the field */
  label: string
  /** Whether the field is currently visible */
  isVisible: boolean
  /**
   * Handler for toggling visibility. Withheld for a preview row (the drag
   * ghost), which is what collapses it to grip + name.
   */
  onToggleVisibility?: (visible: boolean) => void
  /** Last row of the panel — see `FieldPanel`'s `rowBorders='managed'`. */
  isLastRow?: boolean
}

/**
 * Sortable row for dialog config mode.
 *
 * Mirrors FieldPanelRow DOM structure (data-slot="field-row") so there is
 * zero layout shift when toggling between normal and config mode.
 * GripVertical replaces the type icon; Switch replaces the input content.
 *
 * There is deliberately NO `SortableContext` around it (see
 * `fields/ui/field-group-list.tsx`): nothing displaces, so `useSortable` never
 * resolves a `transform` and applying one would be dead code. The row fades in
 * place at 0.3 — the same value `FieldEditRow`, `FieldGroupRow` and the KB
 * sidebar use — and the `DragOverlay` ghost is what follows the pointer.
 */
export const DialogFieldConfigRow = memo(function DialogFieldConfigRow({
  id,
  label,
  isVisible,
  onToggleVisibility,
  isLastRow = false,
}: DialogFieldConfigRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      data-slot='field-row'
      data-last-row={isLastRow ? '' : undefined}
      className={cn(
        'relative flex border-b dark:border-b-[#404754]/20',
        isDragging && 'opacity-30',
        !isVisible && 'opacity-50'
      )}>
      {/* Label area — matches FieldPanelRow [data-slot="field-row-label"] */}
      <div
        data-slot='field-row-label'
        className='flex flex-row gap-1 ps-2 items-center cursor-grab active:cursor-grabbing'
        {...attributes}
        {...listeners}>
        <GripVertical className='size-4 text-neutral-400 shrink-0' />
        <div className='text-sm'>
          <span className='text-primary-600'>{label}</span>
        </div>
      </div>

      {/* Content area — matches FieldPanelRow [data-slot="field-row-content"] */}
      <div
        data-slot='field-row-content'
        className='w-full flex-1 flex items-center justify-end pe-2 py-1.5'>
        {onToggleVisibility && (
          <Switch checked={isVisible} size='sm' onCheckedChange={onToggleVisibility} />
        )}
      </div>
    </div>
  )
})
