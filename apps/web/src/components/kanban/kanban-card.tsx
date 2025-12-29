// apps/web/src/components/kanban/kanban-card.tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { GripVertical, MessageSquare, CheckSquare, StickyNote } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

/** Custom field definition */
interface CustomField {
  id: string
  name: string
  type: string
}

/** Props for KanbanCard component */
interface KanbanCardProps {
  id: string
  index: number
  title: string
  fields: CustomField[]
  updatedAt?: string | Date
  getValue: (fieldId: string) => unknown
  onClick?: () => void
  onNotesClick?: () => void
  onTasksClick?: () => void
  onCommentsClick?: () => void
  isDragging?: boolean
}

/**
 * Format value for display on card
 */
function formatValue(value: unknown, type: string): string {
  if (value == null) return '—'

  if (type === 'DATE' || type === 'DATETIME') {
    try {
      return new Date(String(value)).toLocaleDateString()
    } catch {
      return String(value)
    }
  }

  if (type === 'CHECKBOX') {
    return value ? '✓' : '✗'
  }

  if (type === 'CURRENCY') {
    const num = Number(value)
    if (!isNaN(num)) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num)
    }
  }

  if (type === 'NUMBER') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return String(value)
}

/**
 * Format relative time for last activity indicator
 */
function formatRelativeTime(date: string | Date): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    return formatDistanceToNowStrict(d, { addSuffix: false })
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' weeks', 'w')
      .replace(' week', 'w')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y')
  } catch {
    return ''
  }
}

/**
 * Kanban card component.
 * Features: drag handle, quick actions on hover, last activity indicator.
 */
export function KanbanCard({
  id,
  index,
  title,
  fields,
  updatedAt,
  getValue,
  onClick,
  onNotesClick,
  onTasksClick,
  onCommentsClick,
  isDragging,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id,
    data: { type: 'card', index },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const dragging = isDragging || isSortableDragging

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-index={index}
      className={cn(
        'bg-background border rounded-lg shadow-sm cursor-pointer transition-all hover:shadow-md group/card',
        dragging && 'opacity-50 shadow-lg rotate-1 scale-105'
      )}
      onClick={onClick}>
      <div className="p-2.5">
        {/* Header row: drag handle + title */}
        <div className="flex items-start gap-1.5">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="p-0.5 mt-0.5 opacity-0 group-hover/card:opacity-100 cursor-grab active:cursor-grabbing touch-none shrink-0"
            onClick={(e) => e.stopPropagation()}>
            <GripVertical className="size-3.5 text-muted-foreground" />
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm leading-snug truncate">{title}</h4>
          </div>
        </div>

        {/* Field values (compact) */}
        {fields.length > 0 && (
          <div className="mt-2 pl-5 space-y-0.5">
            {fields.slice(0, 2).map((field) => {
              const value = getValue(field.id)
              if (value == null) return null
              return (
                <div key={field.id} className="text-xs text-muted-foreground truncate">
                  {formatValue(value, field.type)}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer: quick actions + last activity */}
        <div className="mt-2 pl-5 flex items-center justify-between">
          {/* Quick actions (on hover) */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
            {onNotesClick && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6"
                onClick={(e) => {
                  e.stopPropagation()
                  onNotesClick()
                }}>
                <StickyNote className="size-3.5" />
              </Button>
            )}
            {onTasksClick && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6"
                onClick={(e) => {
                  e.stopPropagation()
                  onTasksClick()
                }}>
                <CheckSquare className="size-3.5" />
              </Button>
            )}
            {onCommentsClick && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6"
                onClick={(e) => {
                  e.stopPropagation()
                  onCommentsClick()
                }}>
                <MessageSquare className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Last activity indicator */}
          {updatedAt && (
            <div className="text-xs text-muted-foreground tabular-nums">
              {formatRelativeTime(updatedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
