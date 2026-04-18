// apps/web/src/components/detail-view/tabs/ticket-link-thread-dialog.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { InputSearch } from '@auxx/ui/components/input-search'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import { Loader2, MessageSquare } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useThreadList, useThreadMutation } from '~/components/threads/hooks'
import type { ThreadMeta } from '~/components/threads/store'

interface LinkThreadDialogProps {
  ticketId: string
  onLinked: () => void
  children: ReactNode
}

/**
 * Dialog for searching and linking existing (unlinked) threads to a ticket.
 */
export function LinkThreadDialog({ ticketId, onLinked, children }: LinkThreadDialogProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)

  // Build filter: unlinked threads only (ticket field is empty), plus optional search
  const filter: ConditionGroup[] = useMemo(() => {
    const conditions: ConditionGroup['conditions'] = [
      { id: 'unlinked', fieldId: 'ticket', operator: 'empty', value: null },
    ]
    if (search.trim()) {
      conditions.push({
        id: 'search',
        fieldId: 'freeText',
        operator: 'contains',
        value: search.trim(),
      })
    }
    return [{ id: 'link-filter', logicalOperator: 'AND' as const, conditions }]
  }, [search])

  const { threads, isLoading } = useThreadList({
    filter,
    sort: { field: 'lastMessageAt', direction: 'desc' },
  })

  const { update } = useThreadMutation()

  const handleLink = () => {
    if (!selectedThreadId) return
    // Optimistic: thread-store flips ticketId immediately, so the thread's
    // badge/state updates across the app. `onLinked()` still refreshes the
    // ticket-side list (which is a server-filtered query).
    update(selectedThreadId, { ticketId: toRecordId('ticket', ticketId) })
    onLinked()
    setOpen(false)
    setSelectedThreadId(null)
    setSearch('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent position='tc' size='md'>
        <DialogHeader>
          <DialogTitle>Link Thread to Ticket</DialogTitle>
          <DialogDescription>Search and select a thread to link to this ticket.</DialogDescription>
        </DialogHeader>

        <InputSearch
          placeholder='Search threads by subject...'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ScrollArea className='h-[300px] -mx-6 px-6 mt-6'>
          {isLoading ? (
            <div className='flex items-center justify-center h-full'>
              <Loader2 className='size-5 animate-spin text-muted-foreground' />
            </div>
          ) : threads.length === 0 ? (
            <div className='flex flex-col items-center justify-center h-full text-muted-foreground text-sm'>
              <MessageSquare className='size-8 mb-2 opacity-50' />
              {search ? 'No unlinked threads match your search' : 'No unlinked threads available'}
            </div>
          ) : (
            <div className='space-y-1 px-1 pt-1'>
              {threads.map((thread) => (
                <ThreadSearchItem
                  key={thread.id}
                  thread={thread}
                  isSelected={thread.id === selectedThreadId}
                  onClick={() =>
                    setSelectedThreadId(thread.id === selectedThreadId ? null : thread.id)
                  }
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <p className='text-xs text-muted-foreground'>Showing unlinked threads only</p>

        <DialogFooter>
          <Button size='sm' variant='ghost' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size='sm' variant='outline' onClick={handleLink} disabled={!selectedThreadId}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ThreadSearchItem({
  thread,
  isSelected,
  onClick,
}: {
  thread: ThreadMeta
  isSelected: boolean
  onClick: () => void
}) {
  const formattedDate = thread.lastMessageAt
    ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: true })
    : ''

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border p-3 transition-colors cursor-pointer',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-info'
          : 'border-border hover:bg-accent'
      )}>
      <div className='flex items-center justify-between gap-2'>
        <span className='font-medium text-sm truncate'>{thread.subject || '(no subject)'}</span>
        <span className='text-xs text-muted-foreground shrink-0'>{formattedDate}</span>
      </div>
      <div className='flex items-center gap-2 mt-1 text-xs text-muted-foreground'>
        <span>{thread.messageCount} messages</span>
        <Badge variant='outline' className='text-[10px] px-1 py-0'>
          {thread.status.toLowerCase()}
        </Badge>
      </div>
    </button>
  )
}
