// apps/web/src/components/workflow/nodes/shared/node-inputs/message-input.tsx

import React from 'react'
import { Label } from '@auxx/ui/components/label'
import { Button } from '@auxx/ui/components/button'
import { MessageSquare, X } from 'lucide-react'
import { createNodeInput, type NodeInputProps } from './base-node-input'
import { api } from '~/trpc/react'
import { Badge } from '@auxx/ui/components/badge'
import { ThreadPicker } from '~/components/pickers/thread-picker'

interface MessageInputProps extends NodeInputProps {
  /** Field name */
  name?: string
  /** Schema name for field propagation */
  schemaName?: string
}

/**
 * Message input component that uses ThreadPicker to select a thread
 * and automatically uses the last message from that thread
 */
export const MessageInput = createNodeInput<MessageInputProps>(
  ({ inputs, errors, onChange, onError, isLoading, name = 'message' }) => {
    const value = inputs[name]
    const error = errors[name]

    // Fetch threads for the picker
    const { data: threadsData } = api.thread.list.useQuery({
      limit: 50,
      contextType: 'all_inboxes',
      sortBy: 'newest',
    })

    // Handle thread selection
    const handleThreadSelect = (threadId: string | null) => {
      if (!threadId || !threadsData?.items) return

      // Find the selected thread
      const selectedThread = threadsData.items.find((t) => t.id === threadId)

      if (selectedThread && selectedThread.messages && selectedThread.messages.length > 0) {
        // Get the last message from the thread
        const lastMessage = selectedThread.messages[selectedThread.messages.length - 1]
        onChange(name, lastMessage)
      }
    }

    const handleRemove = () => {
      onChange(name, null)
    }

    const inputId = `input-${name}`

    // Return just the message picker/display without wrappers or error displays
    if (value) {
      return (
        <div className="border rounded-lg p-3 space-y-2 relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2"
            onClick={handleRemove}
            disabled={isLoading}>
            <X className="h-4 w-4" />
          </Button>

          <div className="pr-8">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{value.subject || 'No subject'}</span>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <div>From: {value.from?.name || value.from?.identifier || 'Unknown'}</div>
              {value.to && <div>To: {value.to?.name || value.to?.identifier || 'Unknown'}</div>}
              {value.textPlain && (
                <div className="mt-2 p-2 bg-muted rounded text-xs">
                  {value.textPlain.substring(0, 100)}
                  {value.textPlain.length > 100 && '...'}
                </div>
              )}
            </div>

            {value.isInbound !== undefined && (
              <Badge variant={value.isInbound ? 'default' : 'secondary'} className="mt-2">
                {value.isInbound ? 'Inbound' : 'Outbound'}
              </Badge>
            )}
          </div>
        </div>
      )
    }

    return (
      <ThreadPicker
        placeholder="Select a thread to use its last message"
        selectedId={null}
        onChange={handleThreadSelect}
        disabled={isLoading}
        threads={threadsData?.items || []}
      />
    )
  }
)
