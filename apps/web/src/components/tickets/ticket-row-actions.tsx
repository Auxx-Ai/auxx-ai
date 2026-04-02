// apps/web/src/components/tickets/ticket-row-actions.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { GitMerge, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { MergeDialog } from '~/components/merge/merge-dialog'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSaveSystemValues } from '~/components/resources/hooks/use-save-system-values'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'

type Props = {
  recordId: RecordId
  status: string
  priority: string
  onActionComplete?: () => void
}

export function TicketRowActions({ recordId, status, priority, onActionComplete }: Props) {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const { save } = useSaveSystemValues(recordId)
  const [mergeOpen, setMergeOpen] = useState(false)

  const { handleDelete, ConfirmDeleteDialog } = useEntityInstanceOperations({
    entityDefinitionId,
    resourceLabel: 'Ticket',
    resourcePlural: 'Tickets',
    onRefetch: onActionComplete,
  })

  const statusField = useSystemField('ticket_status')
  const priorityField = useSystemField('ticket_priority')

  const statusOptions: SelectOption[] = statusField?.options?.options ?? []
  const priorityOptions: SelectOption[] = priorityField?.options?.options ?? []

  // Hide dropdown for merged tickets
  if (status === 'MERGED') return null

  const handleStatusChange = (newStatus: string) => {
    save({ ticket_status: newStatus })
  }

  const handlePriorityChange = (newPriority: string) => {
    save({ ticket_priority: newPriority })
  }

  const handleMergeComplete = () => {
    setMergeOpen(false)
    onActionComplete?.()
  }

  return (
    <>
      <ConfirmDeleteDialog />
      {mergeOpen && (
        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          baseRecordIds={[recordId]}
          onMergeComplete={handleMergeComplete}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 shrink-0'
            onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className='size-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {statusOptions
                .filter((opt) => opt.value !== 'MERGED')
                .map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    selected={opt.value === status}
                    colorClassName={opt.color ? getColorSwatch(opt.color) : undefined}
                    onSelect={() => handleStatusChange(opt.value)}>
                    {opt.label}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change Priority</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {priorityOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  selected={opt.value === priority}
                  colorClassName={opt.color ? getColorSwatch(opt.color) : undefined}
                  onSelect={() => handlePriorityChange(opt.value)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setMergeOpen(true)}>
            <GitMerge className='size-4' />
            Merge…
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem variant='destructive' onClick={() => handleDelete(entityInstanceId)}>
            <Trash2 className='size-4' />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
