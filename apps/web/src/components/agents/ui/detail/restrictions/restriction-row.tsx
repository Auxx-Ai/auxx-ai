// apps/web/src/components/agents/ui/detail/restrictions/restriction-row.tsx
'use client'

import type { ArgRestriction } from '@auxx/lib/agents/restrictions/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface RestrictionRowProps {
  /** Restricted arg name. */
  arg: string
  restriction: ArgRestriction
  /** Resolved label for the bound value (var label or constant rendering). */
  valueLabel: string
  /** True when this arg is identity-scoped (author-floor) — deleting warns. */
  isIdentityArg: boolean
  onEdit: () => void
  onDelete: () => void
}

/**
 * One restricted-argument child row under a tool. Mirrors `TriggerRow`'s
 * hover-revealed `Pencil` / `Trash2` action treatment. The secondary slot
 * renders the binding target + `· required` when set. See plans/chat/v6 phase-4.
 */
export function RestrictionRow({
  arg,
  restriction,
  valueLabel,
  isIdentityArg,
  onEdit,
  onDelete,
}: RestrictionRowProps) {
  const secondary = [`→ ${valueLabel}`, restriction.required ? 'required' : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <TreeRow
      depth={1}
      title={arg}
      secondary={secondary}
      actions={
        <>
          <Tooltip side='left' content='Edit restriction' allowInteraction>
            <button
              type='button'
              onClick={onEdit}
              className='p-1 rounded-md hover:bg-primary/5 opacity-0 group-hover/tree-row:opacity-100'
              aria-label='Edit restriction'>
              <Pencil className='size-4 text-muted-foreground' />
            </button>
          </Tooltip>
          <Tooltip
            side='left'
            content={isIdentityArg ? 'Remove (re-opens to the model)' : 'Remove restriction'}
            allowInteraction>
            <button
              type='button'
              onClick={onDelete}
              className='p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100'
              aria-label='Delete restriction'>
              <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
            </button>
          </Tooltip>
        </>
      }
    />
  )
}
