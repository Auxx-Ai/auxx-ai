// ~/components/mail/chat-thread-item.tsx
'use client'

import React, { useMemo, useCallback } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { cn } from '@auxx/ui/lib/utils'
import { Badge } from '@auxx/ui/components/badge' // Use Badge if needed for tags/status
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useIsThreadSelected, useThreadSelectionStore } from '~/components/threads/store'
import { MessageSquare } from 'lucide-react' // Import chat icon
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar' // For assignee avatar
import type { ThreadListItem } from './types' // Import the shared type

interface ChatThreadItemProps {
  item: ThreadListItem // Use the shared type
  basePath: string // Keep if needed, though selection hook handles navigation
  isSelected: boolean
}

/**
 * Displays a single draggable chat thread item in the list.
 */
export function ChatThreadItem({ item, basePath, isSelected }: ChatThreadItemProps) {
  // --- Hooks ---

  // Use per-item selector for efficient re-renders
  const isMultiSelected = useIsThreadSelected(item.id)

  // Get selection actions from store (stable reference)
  const { setSelectedThreads, setActiveThread, toggleSelection } =
    useThreadSelectionStore.getState()

  if (!item?.id) {
    console.error('ChatThreadItem rendered without valid item or item.id:', item)
    return null // Don't render invalid item
  }

  // --- Drag and Drop ---
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: {
      type: 'thread', // Identify as thread type
      threadId: item.id,
      // Note: messageType computed from integration.provider at API boundary
      messageType: item.messageType,
      get draggedThreadIds() {
        const storeIds = useThreadSelectionStore.getState().selectedThreadIds
        return storeIds.includes(item.id) ? storeIds : [item.id]
      },
    },
    disabled: !item.id,
  })

  const style = useMemo(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition: isDragging ? 'none' : undefined, // Allow normal transitions when not dragging
      opacity: isDragging ? 0.5 : 1, // Dim while dragging
    }),
    [transform, isDragging]
  )

  // --- Event Handlers ---
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()

      if (event.metaKey || event.ctrlKey) {
        // Toggle selection
        toggleSelection(item.id)
        setActiveThread(item.id)
      } else if (event.shiftKey) {
        // Range selection - use selectedThreadIds from context for now
        // Note: For proper range selection, thread IDs need to be passed
        setSelectedThreads([item.id])
        setActiveThread(item.id)
      } else {
        // Normal click - select only this item
        setSelectedThreads([item.id])
        setActiveThread(item.id)
      }
    },
    [item.id, toggleSelection, setSelectedThreads, setActiveThread]
  )

  // --- Display Data ---
  const formattedDate = useMemo(() => {
    return item.lastMessageAt
      ? formatDistanceToNowStrict(new Date(item.lastMessageAt), { addSuffix: false })
      : ''
  }, [item.lastMessageAt])

  // Placeholder for snippet - Chat history isn't typically shown in list item
  const snippet = item.subject || 'Chat Conversation' // Use subject or fallback

  // Get Assignee initials for Avatar Fallback
  const getInitials = (name?: string | null): string => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  // --- Render Logic ---
  if (isDragging) {
    // Optional: Render a simpler placeholder while dragging
    // return (
    //   <div
    //     ref={setNodeRef}
    //     style={style}
    //     className='my-1 h-[68px] rounded-lg border border-dashed border-muted-foreground/30 bg-muted opacity-40'
    //   />
    // )
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      id={`thread-${item.id}`}
      className={cn(
        'relative flex w-full cursor-grab items-start gap-2 rounded-lg border bg-background p-2.5 text-left text-sm shadow-xs transition-all duration-100 ease-in-out active:cursor-grabbing',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Selection styles (apply even if isSelected)
        isMultiSelected &&
          'border-blue-300 bg-blue-50 ring-2 ring-blue-500 ring-offset-1 dark:border-blue-700 dark:bg-blue-900/30',
        // Active selection override (can be same or different)
        isSelected &&
          'border-blue-400 bg-blue-100 ring-2 ring-blue-600 ring-offset-1 dark:border-blue-600 dark:bg-blue-900/50'
      )}
      onClick={handleClick}
      onDragStart={(e) => e.preventDefault()} // Prevent default browser drag
      type="button">
      {/* Icon Column */}
      <div className="shrink-0 pt-0.5">
        <MessageSquare
          className={cn(
            'h-4 w-4',
            isSelected || isMultiSelected
              ? 'text-blue-700 dark:text-blue-400'
              : 'text-muted-foreground'
          )}
        />
      </div>

      {/* Content Column */}
      <div className="grow overflow-hidden">
        <div className="flex items-center justify-between">
          {/* Subject / Chat Title */}
          <span
            className={cn(
              'truncate text-xs font-medium',
              isSelected || isMultiSelected ? 'text-foreground' : 'text-foreground'
            )}>
            {item.subject || 'Chat Conversation'}
          </span>
          {/* Date */}
          <span
            className={cn(
              'ml-2 shrink-0 whitespace-nowrap pl-1 text-xs',
              isSelected || isMultiSelected
                ? 'text-blue-700 dark:text-blue-400'
                : 'text-muted-foreground'
            )}>
            {formattedDate}
          </span>
        </div>

        {/* Second Row: Assignee & potentially snippet/last message indicator */}
        <div className="mt-1 flex items-center justify-between">
          {/* Assignee Avatar/Name */}
          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {item.assignee ? (
              <>
                <Avatar className="h-4 w-4">
                  <AvatarImage
                    src={item.assignee.image ?? undefined}
                    alt={item.assignee.name ?? 'Agent'}
                  />
                  <AvatarFallback className="text-[8px]">
                    {getInitials(item.assignee.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{item.assignee.name ?? 'Assigned'}</span>
              </>
            ) : (
              <span className="italic">Unassigned</span>
            )}
          </div>

          {/* Optional: Placeholder for last message type/icon */}
          {/* <div className="text-xs text-muted-foreground">...</div> */}
        </div>

        {/* Optional: Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map(
              (
                tag // Limit displayed tags
              ) => (
                <Badge key={tag.id} variant="outline" className="px-1 py-0 text-xs">
                  {tag.tag_emoji} {tag.title}
                </Badge>
              )
            )}
          </div>
        )}
      </div>
    </button>
  )
}
