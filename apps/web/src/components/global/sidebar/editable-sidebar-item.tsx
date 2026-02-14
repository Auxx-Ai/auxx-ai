// components/global/sidebar/editable-sidebar-item.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
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
}: EditableSidebarItemProps) {
  // DnD logic
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: id,
    disabled: isLocked || !isDraggable,
  }) // Disable sorting if locked or not explicitly draggable

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
      className={`flex h-7 w-full items-center justify-between px-2 text-sm ${
        isDragging ? 'shadow-lg' : ''
      } ${className}`}>
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
