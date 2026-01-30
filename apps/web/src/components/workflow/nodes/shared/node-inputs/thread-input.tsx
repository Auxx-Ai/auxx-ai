// apps/web/src/components/workflow/nodes/shared/node-inputs/thread-input.tsx

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { formatDistanceToNowStrict } from 'date-fns'
import { useThreadList } from '~/components/threads/hooks'
import type { ThreadMeta, MessageMeta, ParticipantMeta } from '~/components/threads/store'
import type { NodeInputProps } from './base-node-input'

/**
 * Input component for thread selection.
 * Only sets threadId - the parent component (InputTab) handles loading
 * full thread/message data via store hooks.
 */
export function ThreadInput({ inputs, onChange, isLoading }: NodeInputProps) {
  const { threads, isLoading: threadsLoading } = useThreadList({
    contextType: 'all',
    sortBy: 'newest',
  })

  const selectedThreadId = inputs.threadId as string | undefined
  const selectedThread = threads.find((t) => t.id === selectedThreadId)

  return (
    <div className="space-y-2">
      <Select
        value={inputs.threadId || ''}
        onValueChange={(value) => onChange('threadId', value)}
        disabled={threadsLoading || isLoading}>
        <SelectTrigger id="threadId">
          <SelectValue
            placeholder={threadsLoading ? 'Loading threads...' : 'Select a thread'}>
            <div>{selectedThread && (selectedThread.subject || 'No subject')}</div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-w-100">
          {threads.map((thread) => {
            const dateStr = thread.lastMessageAt
              ? formatDistanceToNowStrict(new Date(thread.lastMessageAt), { addSuffix: true })
              : ''
            return (
              <SelectItem key={thread.id} value={thread.id}>
                <div className="flex flex-col gap-1">
                  <span className="font-medium line-clamp-1">
                    {thread.subject || 'No subject'}
                  </span>
                  <span className="text-sm text-muted-foreground line-clamp-1">
                    {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''} · {dateStr}
                  </span>
                </div>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}

interface TransformInput {
  thread: ThreadMeta
  latestMessage: MessageMeta
  from: ParticipantMeta | undefined
  to: ParticipantMeta[]
  cc: ParticipantMeta[]
}

/**
 * Transform thread data to workflow input format.
 * Accepts separated thread, message, and participant data from store hooks.
 */
export function transformThreadToWorkflowInput({
  thread,
  latestMessage,
  from,
  to,
  cc,
}: TransformInput): Record<string, any> {
  return {
    thread: {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      messageCount: thread.messageCount,
      lastMessageAt: thread.lastMessageAt,
    },
    message: {
      id: latestMessage.id,
      subject: latestMessage.subject || thread.subject || '',
      content: {
        text: latestMessage.textPlain || '',
        html: latestMessage.textHtml || '',
      },
      from: from
        ? {
            email: from.identifier || '',
            name: from.name || from.displayName || '',
            contact: from.entityInstanceId || null,
          }
        : null,
      to: to.map((p) => ({
        email: p.identifier || '',
        name: p.name || p.displayName || '',
        contact: p.entityInstanceId || null,
      })),
      cc: cc.map((p) => ({
        email: p.identifier || '',
        name: p.name || p.displayName || '',
        contact: p.entityInstanceId || null,
      })),
      isInbound: latestMessage.isInbound,
      threadId: thread.id,
      snippet: latestMessage.snippet || '',
      receivedAt: latestMessage.sentAt || new Date().toISOString(),
    },
  }
}
