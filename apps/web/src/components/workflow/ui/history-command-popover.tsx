// apps/web/src/components/workflow/ui/history-command-popover.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Clock, History } from 'lucide-react'
import React from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { storeEventBus } from '~/components/workflow/store/event-bus'
import type { NavigationHistoryEntry } from '~/components/workflow/store/history-manager'
import { useHistoryManager } from '~/components/workflow/store/workflow-store-provider'

interface HistoryCommandPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Command popover for history navigation
 */
export function HistoryCommandPopover({ open, onOpenChange }: HistoryCommandPopoverProps) {
  const historyManager = useHistoryManager()
  const [historyEntries, setHistoryEntries] = React.useState<NavigationHistoryEntry[]>([])

  // Follow the stack while the popover is open. Reading once on open made an
  // entry that landed afterwards invisible until a close/reopen cycle — and
  // left the rendered list describing a stack that had moved on. Subscribing
  // costs nothing while closed, which was the constraint that mattered.
  React.useEffect(() => {
    if (!open) return
    // Reverse to show most recent first.
    const read = () => setHistoryEntries(historyManager.getNavigationHistory().reverse())
    read()
    return storeEventBus.on('history:changed', read)
  }, [open, historyManager])

  // Jump by entry id, not by index: an index is only meaningful against the
  // stack length at render time, and the stack moves underneath this list.
  const handleJumpToState = (entryId: string) => {
    historyManager.jumpToEntryId(entryId)
    onOpenChange(false)
  }

  const formatRelativePosition = (position: number): string => {
    if (position === 0) return 'Current State'
    if (position < 0)
      return `${Math.abs(position)} step${Math.abs(position) > 1 ? 's' : ''} backward`
    return `${position} step${position > 1 ? 's' : ''} forward`
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip content='View and navigate history'>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='icon-sm' className='hover:dark:bg-white/15'>
            <History />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className='w-80 p-0 backdrop-blur-sm bg-transparent' align='start'>
        <Command className='bg-transparent'>
          <CommandInput placeholder='Search history...' className='h-9' />
          <CommandList>
            <CommandEmpty>
              <div className='flex items-center gap-2 p-4 text-sm text-muted-foreground'>
                <Clock className='w-4 h-4' />
                No history entries found.
              </div>
            </CommandEmpty>
            {historyEntries.length > 0 && (
              <CommandGroup heading='History Timeline'>
                {historyEntries.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    onSelect={() => handleJumpToState(entry.id)}
                    className={cn(
                      'flex items-center gap-3 justify-between cursor-pointer data-[selected=true]:bg-info/10'
                      // entry.relativePosition === 0 && 'bg-accent/50 font-medium'
                    )}>
                    <span className='text-sm'>{entry.actionDescription}</span>
                    <span
                      className={cn(
                        'text-xs',
                        entry.relativePosition === 0
                          ? 'text-blue-500 font-medium'
                          : 'text-muted-foreground'
                      )}>
                      {formatRelativePosition(entry.relativePosition)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
