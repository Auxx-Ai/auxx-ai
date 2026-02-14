// apps/web/src/components/pickers/thread-picker.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
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
import { formatDistanceToNow } from 'date-fns'
import { Check, Clock, MessageSquare, Users } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'

export interface ThreadData {
  id: string
  subject?: string | null
  lastMessageAt?: Date | string
  participantCount?: number
  messageCount?: number
  status?: 'open' | 'closed' | 'pending'
  participants?: Array<{
    id: string
    email?: string
    name?: string
  }>
}

interface ThreadPickerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selectedId?: string | null // Selected thread ID
  onChange?: (threadId: string | null) => void
  className?: string
  threads?: ThreadData[] // Pre-fetched threads
  children?: React.ReactNode // Custom trigger
  placeholder?: string // Placeholder text for the trigger button
  disabled?: boolean
  align?: 'start' | 'center' | 'end' // Alignment for the popover
  side?: 'top' | 'right' | 'bottom' | 'left' // Side for the popover
  sideOffset?: number // Offset for the popover
  style?: React.CSSProperties // Additional styles for the popover
}

export function ThreadPicker({
  open,
  onOpenChange,
  selectedId,
  onChange,
  className,
  threads = [],
  children,
  placeholder = 'Select Thread',
  disabled = false,
  ...props
}: ThreadPickerProps) {
  // Local state for managing search
  const [searchValue, setSearchValue] = useState('')

  // Find the selected thread
  const selectedThread = threads.find((thread) => thread.id === selectedId)

  // Handle thread selection
  const handleThreadSelect = (threadId: string) => {
    setSearchValue('')
    onChange?.(threadId)
    onOpenChange?.(false)
  }

  // Filter threads based on search
  const filteredThreads = threads.filter((thread) => {
    const searchLower = searchValue.toLowerCase()
    return (
      thread.subject?.toLowerCase().includes(searchLower) ||
      thread.participants?.some(
        (p) =>
          p.email?.toLowerCase().includes(searchLower) ||
          p.name?.toLowerCase().includes(searchLower)
      )
    )
  })

  // Format thread display
  const getThreadDisplay = (thread: ThreadData) => {
    const subject = thread.subject || 'No subject'
    const participantNames = thread.participants
      ?.map((p) => p.name || p.email || 'Unknown')
      .slice(0, 2)
      .join(', ')

    return {
      subject,
      participants: participantNames || 'No participants',
      participantCount: thread.participantCount || thread.participants?.length || 0,
      messageCount: thread.messageCount || 0,
      lastMessageAt: thread.lastMessageAt,
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {children || (
          <Button
            variant='outline'
            disabled={disabled}
            className={cn('w-full justify-start', className)}>
            {selectedThread ? (
              <div className='flex items-center gap-2 truncate'>
                <MessageSquare className='h-4 w-4 shrink-0' />
                <span className='truncate'>{getThreadDisplay(selectedThread).subject}</span>
              </div>
            ) : (
              <span className='text-muted-foreground'>{placeholder}</span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className={cn('w-[400px] p-0', className)} {...props}>
        <Command>
          <CommandInput
            placeholder='Search threads...'
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            <CommandEmpty>No threads found.</CommandEmpty>
            <CommandGroup heading='Threads'>
              {filteredThreads.map((thread) => {
                const display = getThreadDisplay(thread)
                const isSelected = thread.id === selectedId

                return (
                  <CommandItem
                    key={thread.id}
                    value={thread.id}
                    onSelect={() => handleThreadSelect(thread.id)}
                    className='flex items-start justify-between py-3'>
                    <div className='flex-1 space-y-1'>
                      <div className='flex items-center gap-2'>
                        <MessageSquare className='h-4 w-4 shrink-0 text-muted-foreground' />
                        <span className='font-medium truncate'>{display.subject}</span>
                      </div>

                      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
                        <div className='flex items-center gap-1'>
                          <Users className='h-3 w-3' />
                          <span>{display.participants}</span>
                        </div>

                        {display.messageCount > 0 && <span>{display.messageCount} messages</span>}

                        {display.lastMessageAt && (
                          <div className='flex items-center gap-1'>
                            <Clock className='h-3 w-3' />
                            <span>
                              {formatDistanceToNow(new Date(display.lastMessageAt), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                        )}
                      </div>

                      {thread.status && thread.status !== 'open' && (
                        <Badge
                          variant={thread.status === 'closed' ? 'secondary' : 'outline'}
                          className='text-xs'>
                          {thread.status}
                        </Badge>
                      )}
                    </div>

                    {isSelected && <Check className='ml-2 h-4 w-4 shrink-0' />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
