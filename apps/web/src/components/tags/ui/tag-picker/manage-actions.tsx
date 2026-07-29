// apps/web/src/components/tags/ui/tag-picker/manage-actions.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Pencil, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'

interface ManageActionsProps {
  onEdit: () => void
  onDelete: () => void
  /**
   * Whether the viewer may delete. Tags are records: `record.delete` asserts
   * `recordsDelete`, which sits on the `Full` rung — so a member at records
   * `Edit` may rename a tag but not remove it. Defaults to `true` so existing
   * callers are unchanged; pass `false` to hide the button rather than let it 403.
   */
  canDelete?: boolean
  /** When true, render in static (non-hover) mode for the parent-as-current row. */
  alwaysVisible?: boolean
}

/**
 * Slide-in Edit/Delete cluster used by tag rows in manage mode.
 * Mirrors the affordance from `file-picker.tsx`. When `alwaysVisible` is true,
 * the cluster is rendered statically (used for the drilled-in "this folder" row).
 */
export function ManageActions({
  onEdit,
  onDelete,
  canDelete = true,
  alwaysVisible = false,
}: ManageActionsProps) {
  if (alwaysVisible) {
    return (
      <div className='ml-auto flex items-center gap-0.5'>
        <Button
          variant='ghost'
          size='icon-xs'
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}>
          <Pencil />
        </Button>
        {canDelete && (
          <Button
            variant='destructive-hover'
            size='icon-xs'
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}>
            <Trash2 />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      style={{ '--btn-width': '50px' } as CSSProperties}
      className='absolute inset-y-0 right-0 flex items-center translate-x-[calc(var(--btn-width)+8px)] group-hover/tag:translate-x-0 transition-transform duration-200 ease-out'>
      <div className='w-4 h-full bg-gradient-to-r from-transparent to-accent/50 dark:to-[#404754]/50 transition-opacity duration-200' />
      <div className='flex items-center gap-0.5 bg-accent/50 dark:bg-[#404754]/50 pr-0.5'>
        <Button
          variant='ghost'
          size='icon-xs'
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}>
          <Pencil />
        </Button>
        {canDelete && (
          <Button
            variant='destructive-hover'
            size='icon-xs'
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}>
            <Trash2 />
          </Button>
        )}
      </div>
    </div>
  )
}
