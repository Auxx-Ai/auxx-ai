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
import { NodeBadge } from './node-badge'

/**
 * One entry's description: a badge for the node it acted on, or the plain
 * sentence when it acted on no single node (edges, layout, a Kopilot edit, a
 * version restore).
 *
 * A rename renders BOTH names — old badge, verb, new badge — with the second
 * one iconless, so it reads as one node changing name rather than two nodes.
 * Titles come from the entry, never a live lookup: the point of the row is what
 * the node was called at the time.
 */
function HistoryEntryDescription({ entry }: { entry: NavigationHistoryEntry }) {
  if (!entry.subject || !entry.verb) {
    return <span className='text-sm truncate'>{entry.actionDescription}</span>
  }

  return (
    // `min-w-0` at every level, or the badges' `truncate` cannot shrink and the
    // row pushes the step counter off the popover instead.
    <span className='flex min-w-0 items-center gap-1.5'>
      <NodeBadge
        size='sm'
        className='min-w-0'
        nodeId={entry.subject.id}
        title={entry.subject.title}
        nodeType={entry.subject.nodeType}
      />
      <span className='shrink-0 text-sm'>{entry.verb}</span>
      {entry.renamedTo && (
        <NodeBadge size='sm' className='min-w-0' title={entry.renamedTo} showIcon={false} />
      )}
    </span>
  )
}

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
                      'flex min-w-0 items-center gap-3 justify-between cursor-pointer data-[selected=true]:bg-info/10'
                      // entry.relativePosition === 0 && 'bg-accent/50 font-medium'
                    )}>
                    <HistoryEntryDescription entry={entry} />
                    <span
                      className={cn(
                        'text-xs shrink-0',
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
