// apps/web/src/components/dashboard/ui/widget/widget-card.tsx
'use client'

// The widget shell: a shadcn Card with a compact header (drag grip · title ·
// hover-revealed edit-mode actions) and a flex body slot the content renderers
// fill. Presentational + prop-driven — selection state, edit mode, and the
// action handlers come from the parent (plan 06 store wiring lives in plan 08).
// The grip carries the `widget-drag-handle` class the grid's `draggableHandle`
// keys on (plan 04) — keep them in sync.

import type { WidgetKind } from '@auxx/lib/dashboards/client'
import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { cn } from '@auxx/ui/lib/utils'
import { Copy, GripVertical, Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

type WidgetCardProps = {
  title: string
  kind: WidgetKind
  isEditMode: boolean
  isSelected?: boolean
  /**
   * Whether this kind has a config drawer. When false (e.g. richText edits inline
   * in its body), the pencil is hidden and card-click no longer selects/opens the
   * drawer — clicks fall through to the widget body. Grip/duplicate/delete stay.
   */
  hasConfigPanel?: boolean
  /** Click anywhere on the card (edit mode) selects the widget + opens config. */
  onSelect?: () => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  children: ReactNode
}

export function WidgetCard({
  title,
  kind,
  isEditMode,
  isSelected,
  hasConfigPanel = true,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  children,
}: WidgetCardProps) {
  // Notes look like notes: richText hides its chrome title in view mode.
  const showTitle = !(kind === 'richText' && !isEditMode)

  return (
    <Card
      onClick={isEditMode && hasConfigPanel ? onSelect : undefined}
      className={cn(
        'group/widget flex h-full flex-col gap-0 overflow-hidden py-0',
        isEditMode &&
          hasConfigPanel &&
          'cursor-pointer ring-1 ring-border transition-shadow hover:ring-primary/50',
        isEditMode && hasConfigPanel && isSelected && 'ring-2 ring-primary hover:ring-primary'
      )}>
      {(showTitle || isEditMode) && (
        <div className='flex h-9 shrink-0 items-center gap-1 px-3'>
          {isEditMode && (
            <GripVertical
              className='widget-drag-handle -ml-1 size-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing'
              aria-label='Drag widget'
            />
          )}
          {showTitle && <span className='truncate font-medium text-sm'>{title}</span>}
          {isEditMode && (
            <div className='ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/widget:opacity-100'>
              {hasConfigPanel && (
                <WidgetAction icon={<Pencil />} label='Edit widget' onClick={onEdit} />
              )}
              <WidgetAction icon={<Copy />} label='Duplicate widget' onClick={onDuplicate} />
              <WidgetAction
                icon={<Trash2 />}
                label='Delete widget'
                onClick={onDelete}
                destructive
              />
            </div>
          )}
        </div>
      )}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3'>{children}</div>
    </Card>
  )
}

function WidgetAction({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <Button
      variant='ghost'
      size='icon-sm'
      aria-label={label}
      className={cn(destructive && 'text-muted-foreground hover:text-destructive')}
      onClick={(e) => {
        // Don't let the action bubble to the card's select handler.
        e.stopPropagation()
        onClick?.()
      }}>
      {icon}
    </Button>
  )
}
