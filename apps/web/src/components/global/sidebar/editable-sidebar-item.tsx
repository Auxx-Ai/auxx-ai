// components/global/sidebar/editable-sidebar-item.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'

interface EditableSidebarItemProps {
  id: string
  name: string
  icon?: ReactNode
  count?: number
  isVisible: boolean
  isLocked?: boolean
  onToggleVisibility: (id: string) => void
  className?: string
  // Props for dnd-kit integration (optional, only passed when draggable)
  isDraggable?: boolean
  /** Arbitrary data attached to the sortable, read in the DndContext's onDragEnd. */
  dndData?: Record<string, unknown>
  /** Show a blue drop-target outline while another row is dragged over this one. */
  showDropIndicator?: boolean
}

export function EditableSidebarItem({
  id,
  name,
  icon,
  count,
  isVisible,
  isLocked = false,
  onToggleVisibility,
  className = '',
  isDraggable = true, // Default to not draggable
  dndData,
  showDropIndicator = false,
}: EditableSidebarItemProps) {
  // DnD logic
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: id,
      disabled: isLocked || !isDraggable,
      data: dndData,
    }) // Disable sorting if locked or not explicitly draggable

  const isDropOver = showDropIndicator && isOver && !isDragging

  const style: HTMLAttributes<HTMLDivElement>['style'] = isDraggable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : undefined, // Ensure dragging item is on top
      }
    : {} // No specific style if not draggable

  return (
    <div
      ref={isDraggable ? setNodeRef : undefined} // Only set ref if draggable
      style={style}
      className={cn(
        'flex h-7 w-full items-center justify-between rounded-md px-2 text-sm',
        isDragging && 'shadow-lg',
        isDropOver && 'bg-blue-500/10 ring-2 ring-inset ring-blue-500/50',
        className
      )}>
      <div className='flex items-center'>
        {isDraggable && !isLocked ? (
          // Draggable handle (only if draggable and not locked)
          <div className='mr-2 cursor-move touch-none' {...attributes} {...listeners}>
            <GripVertical className='size-4 text-muted-foreground' />
          </div>
        ) : (
          // For locked items, show icon in place of drag handle
          icon && <span className='mr-2'>{icon}</span>
        )}
        <span>{name}</span>
      </div>

      {/* Locked items can't be toggled */}
      {isLocked ? (
        <div className='flex items-center space-x-2 opacity-50'>
          {/* Show count even if locked? */}
          {count ? <Badge variant='secondary'>{count}</Badge> : null}
          <Checkbox checked={true} disabled />
        </div>
      ) : (
        <div className='flex items-center space-x-2'>
          {count ? <Badge variant='secondary'>{count}</Badge> : null}
          <Checkbox
            checked={isVisible}
            className='border-blue-500 data-[state=checked]:border-info data-[state=checked]:bg-info'
            onCheckedChange={() => onToggleVisibility(id)}
            disabled={isDragging} // Disable checkbox while dragging
          />
        </div>
      )}
    </div>
  )
}
