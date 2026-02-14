// apps/web/src/components/workflow/nodes/core/manual/connected-input-item.tsx

import { Badge } from '@auxx/ui/components/badge'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { forwardRef } from 'react'

/**
 * Props for ConnectedInputItem component
 */
interface ConnectedInputItemProps {
  /** Node title to display */
  title: string
  /** Whether the input is required */
  required: boolean
  /** Node icon element */
  icon: React.ReactNode
  /** Drag handle attributes (from useSortable) */
  attributes?: React.HTMLAttributes<HTMLDivElement>
  /** Drag handle listeners (from useSortable) */
  listeners?: Record<string, Function | undefined>
  /** Style for transform/transition during drag */
  style?: React.CSSProperties
  /** Whether the item is being dragged */
  isDragging?: boolean
  /** Whether this is rendered in the overlay */
  isOverlay?: boolean
  /** Whether the item is hovered */
  isHovered?: boolean
  /** Handler for edit action */
  onEdit?: () => void
  /** Handler for remove action */
  onRemove?: () => void
}

/**
 * Presentational component for a connected form-input item
 * Used by both SortableInputItem and DragOverlay
 */
export const ConnectedInputItem = forwardRef<HTMLDivElement, ConnectedInputItemProps>(
  (
    {
      title,
      required,
      icon,
      attributes,
      listeners,
      style,
      isDragging,
      isOverlay,
      isHovered,
      onEdit,
      onRemove,
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        style={style}
        className={cn('flex items-center gap-2 pe-1 ps-1', isDragging && !isOverlay && '')}>
        <InputGroup className={cn(isDragging && !isOverlay && 'opacity-20')}>
          <InputGroupAddon align='inline-start'>
            <div
              {...attributes}
              {...listeners}
              className={cn(
                'flex items-center justify-center size-4 shrink-0',
                !isOverlay && 'cursor-grab',
                isOverlay && 'cursor-grabbing'
              )}>
              {isHovered || isOverlay ? (
                <GripVertical className='size-3 text-muted-foreground group-hover/input-group:text-primary-600' />
              ) : (
                <span className='[&>svg]:size-3'>{icon}</span>
              )}
            </div>
          </InputGroupAddon>
          <InputGroupText className='ms-1 flex-1 truncate'>{title}</InputGroupText>
          <InputGroupAddon align='inline-end' className='pe-2.5 gap-1'>
            {required && (
              <Badge variant='secondary' className='text-[10px] px-1.5 py-0 h-5'>
                Required
              </Badge>
            )}
            <InputGroupButton
              type='button'
              variant='ghost'
              className='rounded-lg'
              aria-label='Edit input'
              title='Edit'
              size='icon-xs'
              onClick={onEdit}
              disabled={isOverlay}>
              <Pencil />
            </InputGroupButton>
            <InputGroupButton
              type='button'
              variant='destructive-hover'
              className='rounded-lg'
              aria-label='Remove input'
              title='Remove'
              size='icon-xs'
              onClick={onRemove}
              disabled={isOverlay}>
              <Trash2 />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
)

ConnectedInputItem.displayName = 'ConnectedInputItem'
