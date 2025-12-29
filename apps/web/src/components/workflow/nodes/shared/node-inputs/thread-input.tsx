// apps/web/src/components/workflow/nodes/shared/node-inputs/thread-input.tsx

import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Loader2 } from 'lucide-react'
import { api } from '~/trpc/react'
import type { NodeInputProps } from './base-node-input'

/**
 * Input component for thread selection
 * Can be used for MESSAGE_RECEIVED trigger or any node that needs thread input
 */
export function ThreadInput({ inputs, errors, onChange, onError, isLoading }: NodeInputProps) {
  // Get recent threads
  const threadsQuery = api.thread.list.useQuery(
    { contextType: 'all', limit: 20, sortBy: 'newest' },
    { enabled: !isLoading }
  )

  // Get full thread details when a thread is selected
  const selectedThreadId = inputs.threadId as string | undefined
  const threadDetailQuery = api.thread.getById.useQuery(
    { threadId: selectedThreadId! },
    { enabled: !!selectedThreadId && !isLoading }
  )

  // Find the selected thread for display
  const selectedThread = threadsQuery.data?.items?.find((t: any) => t.id === selectedThreadId)

  // Memoize the onChange handler to prevent re-renders
  const handleThreadChange = React.useCallback(
    (value: string) => {
      onChange('threadId', value)

      // If thread details are loaded, propagate the thread data
      if (threadDetailQuery.data) {
        onChange('thread', threadDetailQuery.data)
      }
    },
    [onChange, threadDetailQuery.data]
  )

  // Return just the thread selector without wrappers or error displays
  return (
    <div className="space-y-2">
      <Select
        value={inputs.threadId || ''}
        onValueChange={handleThreadChange}
        disabled={threadsQuery.isLoading || isLoading}>
        <SelectTrigger id="threadId">
          <SelectValue
            placeholder={threadsQuery.isLoading ? 'Loading threads...' : 'Select a thread'}>
            <div>
              {selectedThread &&
                (selectedThread.subject || selectedThread.messages?.[0]?.subject || 'No subject')}
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-100">
          {threadsQuery.data?.items?.map((thread: any) => {
            const latestMessage = thread.messages?.[0]
            const sender = latestMessage?.from
            return (
              <SelectItem key={thread.id} value={thread.id}>
                <div className="flex flex-col gap-1">
                  <span className="font-medium line-clamp-1">
                    {thread.subject || latestMessage?.subject || 'No subject'}
                  </span>
                  <span className="text-sm text-muted-foreground line-clamp-1">
                    From: {sender?.name || sender?.displayName || sender?.identifier || 'Unknown'}
                  </span>
                  {latestMessage?.snippet && (
                    <span className="text-xs text-muted-foreground line-clamp-1">
                      {latestMessage.snippet}
                    </span>
                  )}
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      {/* Show loading indicator when fetching thread details */}
      {inputs.threadId && threadDetailQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading thread details...
        </div>
      )}
    </div>
  )
}

/**
 * Transform thread data to workflow input format
 */
export function transformThreadToWorkflowInput(thread: any): Record<string, any> {
  const latestMessage = thread.messages?.[0] // Messages are ordered by sentAt desc

  if (!latestMessage) {
    return { thread: thread }
  }

  return {
    thread: thread,
    message: {
      id: latestMessage.id,
      subject: latestMessage.subject || thread.subject || '',
      content: { text: latestMessage.textPlain || '', html: latestMessage.textHtml || '' },
      from: latestMessage.from
        ? {
            email: latestMessage.from.identifier || '',
            name: latestMessage.from.name || latestMessage.from.displayName || '',
            contact: latestMessage.from.contact || null,
          }
        : null,
      to:
        latestMessage.participants
          ?.filter((p: any) => p.role === 'TO')
          .map((p: any) => ({
            email: p.participant?.identifier || '',
            name: p.participant?.name || p.participant?.displayName || '',
            contact: p.participant?.contact || null,
          })) || [],
      cc:
        latestMessage.participants
          ?.filter((p: any) => p.role === 'CC')
          .map((p: any) => ({
            email: p.participant?.identifier || '',
            name: p.participant?.name || p.participant?.displayName || '',
            contact: p.participant?.contact || null,
          })) || [],
      isInbound: true,
      isRead: latestMessage.isRead || false,
      threadId: thread.id,
      snippet: latestMessage.snippet || '',
      receivedAt: latestMessage.sentAt || new Date().toISOString(),
    },
  }
}
