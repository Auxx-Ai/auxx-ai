// apps/web/src/components/kbar/pages/thread-preview.tsx
'use client'

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ReadOnlyThreadProvider } from '~/components/mail/read-only-thread-provider'
import { ThreadMessages } from '~/components/mail/thread-messages'
import { useThread } from '~/components/threads/hooks'
import type { ThreadStatus } from '~/components/threads/store'

/** Badge variant per thread status — muted greys for terminal states. */
const STATUS_VARIANT: Record<ThreadStatus, Variant> = {
  OPEN: 'blue',
  ARCHIVED: 'green',
  SPAM: 'amber',
  TRASH: 'gray',
}

const STATUS_LABEL: Record<ThreadStatus, string> = {
  OPEN: 'Open',
  ARCHIVED: 'Done',
  SPAM: 'Spam',
  TRASH: 'Trash',
}

/**
 * Read-only preview of a thread's messages on the right pane of the palette's
 * thread reader. Reuses {@link ThreadMessages} (email + chat, scheduled + system
 * lines) under a {@link ReadOnlyThreadProvider} so no reply box or per-message
 * action affordances render. Loading falls out of `ThreadMessages`' own skeleton.
 */
export function ThreadPreview({ threadId }: { threadId: string | null }) {
  const { thread } = useThread({ threadId, enabled: !!threadId })

  if (!threadId) {
    return (
      <div className='hidden min-w-0 items-center justify-center p-6 text-center text-sm text-primary-400 md:flex'>
        Select a thread to read.
      </div>
    )
  }

  const status = thread?.status

  return (
    <div className='hidden min-w-0 flex-col overflow-hidden md:flex'>
      <ScrollArea className='min-h-0 flex-1'>
        {/* Sticky header — subject + status badge */}
        <div className='sticky top-0 z-10 flex items-start gap-2.5 bg-background/90 px-4 pt-4 pb-3 backdrop-blur-lg'>
          <div className='min-w-0 flex-1 truncate font-medium text-sm'>
            {thread?.subject || '(no subject)'}
          </div>
          {status && (
            <Badge
              variant={STATUS_VARIANT[status] ?? 'gray'}
              size='xs'
              className='shrink-0 uppercase tracking-wide'>
              {STATUS_LABEL[status] ?? status}
            </Badge>
          )}
        </div>

        <ReadOnlyThreadProvider threadId={threadId}>
          <ThreadMessages />
        </ReadOnlyThreadProvider>
      </ScrollArea>
    </div>
  )
}
