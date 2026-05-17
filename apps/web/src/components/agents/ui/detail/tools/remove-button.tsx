// apps/web/src/components/agents/ui/detail/tools/remove-button.tsx
'use client'

import { Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'

interface RemoveButtonProps {
  enabled: boolean
  tooltip: string
  onClick: () => void
}

/**
 * Trash icon button shared by leaf + container rows in the installed-tools
 * tree. Hover-revealed via the parent `<TreeRow>`'s `group/tree-row`. When
 * `enabled` is false, renders disabled with the supplied lock tooltip.
 */
export function RemoveButton({ enabled, tooltip, onClick }: RemoveButtonProps) {
  return (
    <Tooltip side='left' content={tooltip}>
      <button
        type='button'
        disabled={!enabled}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className='p-1 rounded-md opacity-0 group-hover/tree-row:opacity-100 enabled:hover:bg-destructive/10 disabled:cursor-not-allowed'
        aria-label={enabled ? 'Remove' : 'Cannot remove — locked'}>
        <Trash2
          className={`size-4 text-muted-foreground ${enabled ? 'hover:text-destructive' : ''}`}
        />
      </button>
    </Tooltip>
  )
}
