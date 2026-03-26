// apps/web/src/components/mail/standalone-draft-item.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNowStrict } from 'date-fns'
import { Clock } from 'lucide-react'
import { useMemo } from 'react'
import { useThreadStore } from '~/components/threads/store'
import { useCompose } from '~/hooks/use-compose'
import type { DraftMessageType } from './email-editor/types'
import { getIntegrationIcon } from './mail-status-config'

/**
 * Props for the StandaloneDraftItem component.
 */
export interface StandaloneDraftItemProps {
  /** Draft ID to fetch and display */
  draftId: string
}

/**
 * Displays a standalone draft item in the thread list.
 * Standalone drafts are new compose drafts that don't belong to any thread.
 */
export function StandaloneDraftItem({ draftId }: StandaloneDraftItemProps) {
  const { openDraft } = useCompose()

  // Get draft from store
  const draft = useThreadStore((s) => s.standaloneDrafts.get(draftId))
  const isDraftLoading = useThreadStore((s) => s.isDraftLoading(draftId))

  // Derived values
  const formattedDate = useMemo(() => {
    return draft?.updatedAt
      ? formatDistanceToNowStrict(new Date(draft.updatedAt), { addSuffix: false })
      : ''
  }, [draft?.updatedAt])

  // Click handler - opens the draft in a floating compose editor
  const handleClick = () => {
    if (!draft) return
    // Pass a minimal DraftMessageType with the ID so FloatingCompose can fetch full content
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

  // Loading state
  if (isDraftLoading || !draft) {
    return <DraftItemSkeleton />
  }

  return (
    <>
      <div className='flex flex-row items-stretch relative'>
        <div
          id={`draft-${draftId}`}
          className={cn(
            'z-2 hover:bg-accent hover:text-accent-foreground dark:border-slate-700 group relative flex w-full cursor-pointer flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3 text-left text-sm dark:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
          )}
          onClick={handleClick}>
          {/* Status indicator: amber clock for scheduled, red dot for draft */}
          {draft.scheduledAt ? (
            <div className='absolute left-1.5 top-8 text-amber-500' aria-label='Scheduled'>
              <Clock className='size-3' />
            </div>
          ) : (
            <div
              className='absolute left-2 top-9 h-2 w-2 -translate-y-1/2 rounded-full bg-red-500'
              aria-label='Draft'
            />
          )}

          <div className='absolute top-3 left-1'>
            <div className='flex-none rounded-full border p-0.5 text-blue-500'>
              {getIntegrationIcon(draft.integrationProvider)}
            </div>
          </div>

          {/* Content */}
          <div className='flex w-full flex-col gap-1'>
            <div className='flex items-center'>
              <div className='flex items-center ms-0.5 gap-0.5 overflow-hidden'>
                <div className='flex-1 truncate font-semibold'>
                  {draft.recipientSummary || '(no recipients)'}
                </div>
              </div>
              <div className='ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-muted-foreground'>
                {draft.scheduledAt ? (
                  <span className='flex items-center gap-1 text-amber-600 dark:text-amber-400'>
                    <Clock className='size-3' />
                    {formatScheduledTime(new Date(draft.scheduledAt))}
                  </span>
                ) : (
                  formattedDate
                )}
              </div>
            </div>

            {/* Subject */}
            <div className='flex w-full items-center gap-1 min-w-0'>
              <div className='min-w-0 truncate text-xs font-medium max-w-[60%] shrink-0'>
                {draft.subject || '(no subject)'}
              </div>
            </div>
          </div>

          {/* Snippet */}
          {draft.snippet && (
            <div className='line-clamp-2 w-full break-words text-xs text-muted-foreground'>
              {draft.snippet}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Format a scheduled date for display. */
function formatScheduledTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

/**
 * Skeleton for loading draft item.
 */
function DraftItemSkeleton() {
  return (
    <div className='flex flex-row items-stretch relative'>
      <div className='z-2 group relative flex w-full flex-col items-start gap-1 rounded-lg border bg-background ps-6 pe-2 py-3'>
        <div className='flex w-full flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <Skeleton className='h-4 w-1/3' />
            <Skeleton className='h-3 w-16' />
          </div>
          <Skeleton className='h-3 w-2/3' />
          <Skeleton className='h-3 w-full' />
        </div>
      </div>
    </div>
  )
}
