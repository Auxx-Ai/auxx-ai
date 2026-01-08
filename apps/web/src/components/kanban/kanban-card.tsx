// apps/web/src/components/kanban/kanban-card.tsx
'use client'

import { useDraggable } from '@dnd-kit/core'
import { cn } from '@auxx/ui/lib/utils'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { MessageSquare, CheckSquare, StickyNote, Box } from 'lucide-react'
import { formatRelativeTime } from '@auxx/utils/date'
import { formatToRawValue } from '@auxx/lib/field-values/client'
import type { CustomField } from '~/components/custom-fields/context/entity-records-context'
import { KanbanCardField } from './kanban-card-field'
import { useCustomFieldValue, type ResourceType } from '~/stores/custom-field-value-store'

/** Props for KanbanCard component */
interface KanbanCardProps {
  id: string
  fields: CustomField[]
  updatedAt?: string | Date
  onClick?: () => void
  onNotesClick?: () => void
  onTasksClick?: () => void
  onCommentsClick?: () => void
  isDragging?: boolean
  /** Whether this card is selected for bulk actions */
  isSelected?: boolean
  /** Callback when selection changes */
  onSelectChange?: (selected: boolean) => void
  /** Whether this card is being dragged as part of a multi-select */
  isBeingDragged?: boolean
  /** When true, clicking the card toggles selection instead of opening drawer */
  massSelectMode?: boolean
  /** Resource type for store subscription */
  resourceType: ResourceType
  /** Entity definition ID (required for 'entity' resourceType) */
  entityDefId?: string
  /** Primary field ID for card title */
  primaryFieldId?: string
  /** Enable inline field editing (default: true) */
  editable?: boolean
}

/**
 * Kanban card component.
 * Features: drag handle, quick actions on hover, last activity indicator.
 * Fetches title from store directly (self-contained and reactive).
 */
export function KanbanCard({
  id,
  fields,
  updatedAt,
  onClick,
  onNotesClick,
  onTasksClick,
  onCommentsClick,
  isDragging,
  isSelected = false,
  onSelectChange,
  isBeingDragged = false,
  massSelectMode = false,
  resourceType,
  entityDefId,
  primaryFieldId,
  editable = true,
}: KanbanCardProps) {
  // Fetch title directly from store (same pattern as KanbanCardField)
  const primaryValue = useCustomFieldValue(resourceType, id, primaryFieldId ?? '', entityDefId)

  // Format title for display
  const title =
    primaryFieldId && primaryValue
      ? String(formatToRawValue(primaryValue, 'TEXT') ?? 'Untitled')
      : 'Untitled'
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging: isDraggableDragging,
  } = useDraggable({
    id,
    data: { type: 'card' },
  })

  // Don't apply transform - we use DragOverlay for the moving card
  // The original stays in place as a placeholder
  const dragging = isDragging || isDraggableDragging

  // Show as placeholder if this card is the active draggable OR part of a multi-select drag
  const showAsPlaceholder = isDraggableDragging || isBeingDragged

  /** Handle card content click - respects mass select mode */
  const handleContentClick = () => {
    if (massSelectMode) {
      onSelectChange?.(!isSelected)
    } else {
      onClick?.()
    }
  }

  return (
    <div
      ref={setNodeRef}
      data-kanban-card
      {...attributes}
      {...listeners}
      onClick={handleContentClick}
      className={cn(
        'bg-background cursor-default dark:bg-muted border rounded-lg shadow-sm transition-all hover:shadow-md group/card select-none touch-none relative',
        isSelected && 'border-info/90 bg-info/8 dark:bg-info/10',
        isDragging && 'shadow-lg rotate-1 scale-105 ',
        showAsPlaceholder &&
          'shadow-none bg-primary-200/50 dark:bg-muted dark:border-white/3 border-primary-200',
        massSelectMode && 'cursor-pointer'
      )}>
      {/* Drag placeholder overlay */}
      <div className={cn('p-2.5', showAsPlaceholder && 'invisible')}>
        {/* Header row: checkbox/box icon + title */}
        <div className="flex items-start gap-1.5">
          {/* Box icon - becomes checkbox on card hover or when selected */}
          <div
            className="mt-0.5 shrink-0 relative size-3.5"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onSelectChange?.(!isSelected)
            }}>
            <Box
              className={cn(
                'absolute inset-0 size-3.5 text-muted-foreground',
                // Hide Box when: selected, hovering, or in mass select mode
                isSelected || massSelectMode ? 'hidden' : 'group-hover/card:hidden'
              )}
            />
            <Checkbox
              checked={isSelected}
              className={cn(
                'absolute inset-0 size-3.5 pointer-events-none [&_svg]:size-3!',
                // Show checkbox when: selected, hovering, or in mass select mode
                !isSelected && !massSelectMode && 'hidden group-hover/card:block'
              )}
            />
          </div>

          {/* Title - clickable to open drawer (or toggle selection in mass select mode) */}
          <div className="flex-1 min-w-0">
            <h4
              className={cn(
                'font-medium text-sm leading-snug truncate',
                isSelected && 'font-semibold'
              )}>
              {title}
            </h4>
          </div>
        </div>

        {/* Field values - uses KanbanCardField for consistent rendering and inline editing */}
        {fields.length > 0 && (
          <div className="mt-2  space-y-0.5">
            {fields.map((field) => (
              <div key={field.id} className="text-xs text-muted-foreground truncate">
                <KanbanCardField
                  resourceType={resourceType}
                  entityDefId={entityDefId}
                  rowId={id}
                  field={field}
                  editable={editable && !massSelectMode && !isDragging}
                />
              </div>
            ))}
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
            <div
              className={cn(
                'text-xs text-muted-foreground tabular-nums',
                isSelected && 'text-info'
              )}>
              {formatRelativeTime(updatedAt, true)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
