// apps/web/src/components/records/layout-editor/rows/layout-section-row.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { TreeRow, TreeRowButton, TreeRowGrip } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useSortable } from '@dnd-kit/sortable'
import { Lock, Rows3, Trash2 } from 'lucide-react'
import { memo } from 'react'
import { resolveLayoutIcon } from '~/components/records/layout/layout-icon'
import type { LayoutEditorRow } from '../editor-tree'

export interface LayoutSectionRowProps {
  row: LayoutEditorRow
  /** Whether the viewer may write the ORG scope. Sections are org-scope only. */
  canAdministerDef: boolean
  /** Hiding this section would leave its tab empty, so its switch locks on. */
  locked: boolean
  /** Rendered inside the drag ghost: no controls, no drop zones. */
  preview?: boolean
  onToggleHidden: () => void
  onDelete: () => void
}

/**
 * One placed section, rendered as a child `TreeRow` of its tab (§9.1 / §9.3).
 *
 * Three states this row exists to make visible rather than to hide:
 *
 * - **Restricted.** A block gated behind a key the editing admin lacks renders
 *   greyed and undraggable, never vanishing. A block that disappeared from the
 *   tree would be silently dropped by the next save, which is precisely the
 *   thing the stored layout must never do.
 * - **Hidden.** An explicit admin hide, which survives any later registry change
 *   and so has to stay listed for it to be reversible.
 * - **Empty here.** The section resolves to nothing for the record the dialog
 *   was opened from. The layout is per DEFINITION, so this is a note about one
 *   record and never a reason to drop the row.
 */
export const LayoutSectionRow = memo(function LayoutSectionRow({
  row,
  canAdministerDef,
  locked,
  preview = false,
  onToggleHidden,
  onDelete,
}: LayoutSectionRowProps) {
  const { block, status } = row
  const draggable = canAdministerDef && !status.restricted && !preview

  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: block.id,
    // The row stays a DROP target while it is not a drag source: a tab dragged
    // onto it is how a tab with sections gets reordered, and a restricted block
    // must not take that away from its neighbours.
    disabled: { draggable: !draggable, droppable: preview },
  })

  const Icon = resolveLayoutIcon(block.icon) ?? Rows3

  return (
    <div
      ref={setNodeRef}
      data-slot='layout-section-row'
      className={cn('w-full', isDragging && 'opacity-30')}>
      <TreeRow
        depth={1}
        icon={
          draggable ? (
            <TreeRowGrip
              icon={<Icon className='size-4 text-neutral-400' />}
              handleProps={{
                ...attributes,
                ...listeners,
                'aria-label': `Move ${block.label}`,
              }}
              isDragging={isDragging}
            />
          ) : (
            <Icon className='size-4 text-neutral-400' />
          )
        }
        rowClassName={cn(
          'bg-transparent hover:bg-primary-100/60',
          (status.restricted || status.hidden) && 'opacity-60'
        )}
        title={<span className='text-sm'>{block.label}</span>}
        secondary={
          <span className='flex items-center gap-1.5 text-neutral-400 text-xs'>
            {status.restricted && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='flex items-center gap-1'>
                    <Lock className='size-3' />
                    Restricted
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  You cannot see this section, so it stays where it is. It is still part of the
                  layout for members who can.
                </TooltipContent>
              </Tooltip>
            )}
            {status.emptyHere && !status.restricted && <span>Empty for this record</span>}
          </span>
        }
        actions={
          preview ? undefined : (
            <div className='flex items-center gap-1'>
              {canAdministerDef && block.kind !== 'card' && row.isCreated && (
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Delete this section (applies to everyone)'
                  aria-label={`Delete ${block.label}`}
                  onClick={onDelete}>
                  <Trash2 />
                </TreeRowButton>
              )}
              <Switch
                size='xs'
                checked={!status.hidden}
                disabled={!canAdministerDef || status.restricted || locked}
                aria-label={`Show the ${block.label} section`}
                onCheckedChange={onToggleHidden}
              />
            </div>
          )
        }
      />
    </div>
  )
})
