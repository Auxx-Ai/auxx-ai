// apps/web/src/components/mail/compact-draft-item.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import { Clock } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useThreadStore } from '~/components/threads/store'
import { useCompose } from '~/hooks/use-compose'
import type { DraftMessageType } from './email-editor/types'
import { getIntegrationIcon } from './mail-status-config'

export interface CompactDraftItemProps {
  draftId: string
}

export const CompactDraftItem = memo(function CompactDraftItem({ draftId }: CompactDraftItemProps) {
  const { openDraft } = useCompose()
  const draft = useThreadStore((s) => s.standaloneDrafts.get(draftId))
  const isDraftLoading = useThreadStore((s) => s.isDraftLoading(draftId))

  const formattedDate = useMemo(() => {
    if (draft?.scheduledAt) {
      return formatScheduledTime(new Date(draft.scheduledAt))
    }
    return draft?.updatedAt
      ? formatDistanceToNowStrict(new Date(draft.updatedAt), { addSuffix: false })
      : ''
  }, [draft?.updatedAt, draft?.scheduledAt])

  const handleClick = () => {
    if (!draft) return
    openDraft({
      id: draftId,
      threadId: null,
      inReplyToMessageId: null,
      includePreviousMessage: false,
      subject: draft.subject || '',
      textHtml: '',
      textPlain: '',
      signatureId: null,
      participants: [],
      attachments: [],
      metadata: {},
      createdAt: draft.updatedAt,
      updatedAt: draft.updatedAt,
    } satisfies DraftMessageType)
  }

  if (isDraftLoading || !draft) {
    return <CompactDraftItemSkeleton />
  }

  return (
    <div
      id={`draft-${draftId}`}
      className='group flex h-9 w-full cursor-pointer items-center border-b border-primary-200 pe-3 text-sm transition-colors hover:bg-accent/50'
      onClick={handleClick}>
      {/* Left padding + status dot area */}
      <div className='flex shrink-0 items-center justify-center ps-3 pe-2 h-9 gap-2'>
        <div className='w-3.5 shrink-0' />
        <div className='flex w-3 shrink-0 items-center justify-center'>
          {draft.scheduledAt ? (
            <Clock className='size-2.5 text-amber-500' />
          ) : (
            <div className='size-2 rounded-full bg-red-500' />
          )}
        </div>
      </div>

      {/* Integration icon */}
      <div className='flex w-5 shrink-0 items-center justify-center ms-0.5'>
        <div className='rounded-full border p-0.5 text-blue-500'>
          {getIntegrationIcon(draft.integrationProvider)}
        </div>
      </div>

      {/* Recipient */}
      <div className='w-[140px] shrink-0 truncate text-xs font-semibold text-foreground ms-2'>
        {draft.recipientSummary || '(no recipients)'}
      </div>

      {/* Subject + Snippet */}
      <div className='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden ms-2'>
        <span className='shrink-0 truncate text-xs font-medium text-foreground/90 max-w-[50%]'>
          {draft.subject || '(no subject)'}
        </span>
        {draft.snippet && (
          <>
            <span className='shrink-0 text-muted-foreground/50'>—</span>
            <span className='min-w-0 truncate text-xs text-muted-foreground'>{draft.snippet}</span>
          </>
        )}
      </div>

      {/* Time */}
      <div className='flex shrink-0 items-center justify-end ms-2'>
        <span
          className={cn(
            'text-xs text-right w-14',
            draft.scheduledAt ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          )}>
          {formattedDate}
        </span>
      </div>
    </div>
  )
})

function formatScheduledTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

function CompactDraftItemSkeleton() {
  return (
    <div className='flex h-9 w-full items-center gap-2 border-b border-primary-200 px-3'>
      <div className='h-3 w-7 animate-pulse rounded bg-muted' />
      <div className='h-3 w-3' />
      <div className='h-4 w-5 animate-pulse rounded bg-muted' />
      <div className='h-3 w-[140px] animate-pulse rounded bg-muted' />
      <div className='h-3 flex-1 animate-pulse rounded bg-muted' />
      <div className='h-3 w-12 animate-pulse rounded bg-muted' />
    </div>
  )
}
