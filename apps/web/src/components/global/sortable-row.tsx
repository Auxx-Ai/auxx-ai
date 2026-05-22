// apps/web/src/components/global/sortable-row.tsx

'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'

interface SortableRowProps {
  id: string
  text: string
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  /** When defined, shown at the start; replaced by the drag handle on hover/focus. */
  icon?: { iconId: string; color?: string }
  /** When defined the row is editable and renders an input; otherwise renders read-only text. */
  onChange?: (text: string) => void
  /** When defined, renders a pencil button before the remove button. */
  onEdit?: () => void
  /** When defined, renders a trash button at the end. */
  onRemove?: () => void
}

/**
 * Shared row used inside a parent `DndContext` + `SortableContext` to render a
 * reorderable item as an `InputGroup`. The row mounts its own `<li>` and
 * `useSortable` so call sites only need the list-level DnD plumbing.
 */
export function SortableRow({
  id,
  text,
  placeholder,
  maxLength,
  disabled,
  icon,
  onChange,
  onEdit,
  onRemove,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  const dragHandle = (
    <InputGroupButton
      type='button'
      aria-label='Drag to reorder'
      title='Drag to reorder'
      size='icon-xs'
      className='cursor-grab touch-none'
      {...attributes}
      {...listeners}>
      <GripVertical />
    </InputGroupButton>
  )

  return (
    <li ref={setNodeRef} style={style}>
      <InputGroup>
        <InputGroupAddon align='inline-start'>
          {icon ? (
            <>
              <span className='flex size-6 items-center justify-center group-hover/input-group:hidden group-focus-within/input-group:hidden'>
                <EntityIcon iconId={icon.iconId} color={icon.color} size='xs' />
              </span>
              <span className='hidden size-6 items-center justify-center group-hover/input-group:flex group-focus-within/input-group:flex'>
                {dragHandle}
              </span>
            </>
          ) : (
            dragHandle
          )}
        </InputGroupAddon>

        {onChange ? (
          <InputGroupInput
            value={text}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        ) : (
          <InputGroupText className='flex-1 truncate px-2'>{text}</InputGroupText>
        )}

        {(onEdit || onRemove) && (
          <InputGroupAddon align='inline-end'>
            {onEdit && (
              <InputGroupButton
                type='button'
                aria-label='Edit'
                title='Edit'
                size='icon-xs'
                onClick={onEdit}
                disabled={disabled}>
                <Pencil />
              </InputGroupButton>
            )}
            {onRemove && (
              <InputGroupButton
                type='button'
                className='rounded-full'
                aria-label='Remove'
                title='Remove'
                size='icon-xs'
                onClick={onRemove}
                disabled={disabled}>
                <Trash2 />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        )}
      </InputGroup>
    </li>
  )
}
