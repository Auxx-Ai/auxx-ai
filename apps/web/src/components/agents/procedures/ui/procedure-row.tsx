// apps/web/src/components/agents/procedures/ui/procedure-row.tsx
'use client'

import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ChevronRight, FileText, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { RouterOutputs } from '~/trpc/react'

type ProcedureLink = RouterOutputs['agentProcedure']['list'][number]

interface ProcedureRowProps {
  row: ProcedureLink
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}

/**
 * One attached-procedure row. Clicking the title drills into the editor; the
 * enable switch + delete live in `actions` (TreeRow stops their propagation) and
 * a static chevron signals the drill-in.
 */
export function ProcedureRow({ row, onOpen, onToggle, onDelete }: ProcedureRowProps) {
  const summary = row.whenToUse?.trim() || 'No description yet'
  return (
    <TreeRow
      icon={<FileText className='size-4 text-muted-foreground' />}
      title={row.name}
      secondary={
        <span className='truncate text-xs text-muted-foreground'>
          {summary}
          {row.hasUnpublishedChanges ? ' · unpublished' : ''}
          {!row.isPublished ? ' · draft' : ''}
        </span>
      }
      onTitleClick={onOpen}
      actions={
        <>
          <Tooltip side='left' content='Delete procedure' allowInteraction>
            <button
              type='button'
              onClick={onDelete}
              aria-label='Delete procedure'
              className='p-1 rounded-md hover:bg-destructive/10 opacity-0 group-hover/tree-row:opacity-100'>
              <Trash2 className='size-4 text-muted-foreground hover:text-destructive' />
            </button>
          </Tooltip>
          <Switch size='xs' className='ml-1' checked={row.enabled} onCheckedChange={onToggle} />
          <button
            type='button'
            onClick={onOpen}
            aria-label='Open procedure'
            className='ml-1 p-1 rounded-md hover:bg-primary/5'>
            <ChevronRight className='size-4 text-muted-foreground' />
          </button>
        </>
      }
    />
  )
}
