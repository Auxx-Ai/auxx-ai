// apps/web/src/components/custom-fields/ui/dialog-field-config-row.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { memo, useMemo } from 'react'

/** Props for DialogFieldConfigRow */
interface DialogFieldConfigRowProps {
  /** Unique ID for the sortable item */
  id: string
  /** Display label for the field */
  label: string
  /** Whether the field is currently visible */
  isVisible: boolean
  /** Handler for toggling visibility */
  onToggleVisibility: (visible: boolean) => void
}

/**
 * Sortable row for dialog config mode.
 * Mirrors VarEditorFieldRow DOM structure (data-slot="field-row") so there is
 * zero layout shift when toggling between normal and config mode.
 * GripVertical replaces the type icon; Switch replaces the input content.
 */
export const DialogFieldConfigRow = memo(function DialogFieldConfigRow({
  id,
  label,
  isVisible,
  onToggleVisibility,
}: DialogFieldConfigRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })

  /** Memoize style to prevent unnecessary re-renders during drag */
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
      data-slot='field-row'
      className={cn(
        'relative flex border-b dark:border-b-[#404754]/20',
        isDragging && 'bg-accent rounded',
        !isVisible && 'opacity-50'
      )}>
      {/* Label area — matches VarEditorFieldRow [data-slot="field-row-label"] */}
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

      {/* Content area — matches VarEditorFieldRow [data-slot="field-row-content"] */}
      <div
        data-slot='field-row-content'
        className='w-full flex-1 flex items-center justify-end pe-2 py-1.5'>
        <Switch checked={isVisible} size='sm' onCheckedChange={onToggleVisibility} />
      </div>
    </div>
  )
})
