// apps/web/src/components/agents/ui/detail/bindings/binding-row.tsx
'use client'

import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Pencil, Trash2 } from 'lucide-react'

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
          <TreeRowButton tooltipText='Edit binding' aria-label='Edit binding' onClick={onEdit}>
            <Pencil />
          </TreeRowButton>
          <TreeRowButton
            variant='destructive'
            tooltipText='Remove override (back to default)'
            aria-label='Delete binding'
            onClick={onDelete}>
            <Trash2 />
          </TreeRowButton>
        </>
      }
    />
  )
}
