// apps/web/src/components/agents/ui/detail/bindings/binding-row.tsx
'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface BindingRowProps {
  /** Bound input name. */
  arg: string
  /** Resolved label for the bound value (field label or constant rendering). */
  valueLabel: string
  onEdit: () => void
  onDelete: () => void
}

/**
 * One bound-input child row under a tool. Mirrors `TriggerRow`'s hover-revealed
 * `Pencil` / `Trash2` action treatment. The secondary slot renders the binding
 * target. See plans/chat/v8 phase-5.
 */
export function BindingRow({ arg, valueLabel, onEdit, onDelete }: BindingRowProps) {
  return (
    <TreeRow
      depth={1}
      title={arg}
      secondary={`→ ${valueLabel}`}
      actions={
        <>
          <Tooltip side='left' content='Edit binding' allowInteraction>
            <button
              type='button'
              onClick={onEdit}
              className='p-1 rounded-md hover:bg-primary/5 opacity-0 group-hover/tree-row:opacity-100'
              aria-label='Edit binding'>
              <Pencil className='size-4 text-muted-foreground' />
            </button>
          </Tooltip>
          <Tooltip side='left' content='Remove override (back to default)' allowInteraction>
            <button
              type='button'
              onClick={onDelete}
              className='p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100'
              aria-label='Delete binding'>
              <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
            </button>
          </Tooltip>
        </>
      }
    />
  )
}
