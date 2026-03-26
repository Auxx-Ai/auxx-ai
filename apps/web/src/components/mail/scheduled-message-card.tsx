// apps/web/src/components/mail/scheduled-message-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Clock, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import type { ScheduledMessageMeta } from '~/components/threads/store/thread-store'
import { SandboxedEmailHtml } from './utils/sandboxed-email-html'

interface ScheduledMessageCardProps {
  scheduledMessage: ScheduledMessageMeta
  onCancel: (id: string) => void
  onEdit: (id: string) => void
  /** Whether the card body is expanded by default */
  defaultExpanded?: boolean
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

export function ScheduledMessageCard({
  scheduledMessage,
  onCancel,
  onEdit,
  defaultExpanded = true,
}: ScheduledMessageCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { sendPayload, scheduledAt, id } = scheduledMessage
  const payload = sendPayload as Record<string, any>

  const toRecipients: Array<{ identifier: string; name?: string }> = payload?.to ?? []
  const ccRecipients: Array<{ identifier: string; name?: string }> = payload?.cc ?? []
  const subject = payload?.subject as string | undefined
  const textHtml = payload?.textHtml as string | undefined
  const textPlain = payload?.textPlain as string | undefined

  return (
    <div className='flex flex-col rounded-2xl border border-amber-300 bg-background shadow-xs ring-5 ring-amber-500/5 hover:ring-amber-500/10 hover:bg-muted dark:border-amber-700'>
      {/* Header — click to toggle body */}
      <div className='cursor-pointer' onClick={() => setExpanded(!expanded)}>
        <div className='flex justify-between gap-2 px-2 py-1'>
          <div className='flex grow items-start gap-1'>
            {/* Avatar area — clock icon instead of sender avatar */}
            <div className='size-8 border border-amber-300 bg-amber-50 rounded-lg flex items-center justify-center shrink-0 mt-2 dark:bg-amber-950/30 dark:border-amber-700'>
              <Clock className='size-4 text-amber-600 dark:text-amber-400' />
            </div>

            <div className='flex flex-col rounded-[6px] px-[7px] py-[3px]'>
              {/* Recipients + subject when expanded, just recipients when collapsed */}
              <div className='flex text-sm'>
                <span className='mr-[4px] shrink-0 text-muted-foreground'>To:</span>
                <span className='min-w-0 truncate'>
                  {toRecipients.map((r) => r.name || r.identifier).join(', ')}
                </span>
              </div>
              {!expanded && subject && (
                <div className='flex text-sm'>
                  <span className='mr-[4px] shrink-0 text-muted-foreground'>Subject:</span>
                  <span className='min-w-0 truncate whitespace-nowrap text-muted-foreground'>
                    {subject}
                  </span>
                </div>
              )}
              {expanded && ccRecipients.length > 0 && (
                <div className='flex text-sm'>
                  <span className='mr-[4px] shrink-0 text-muted-foreground'>Cc:</span>
                  <span className='min-w-0 truncate'>
                    {ccRecipients.map((r) => r.name || r.identifier).join(', ')}
                  </span>
                </div>
              )}
              {expanded && subject && (
                <div className='flex text-sm'>
                  <span className='mr-[4px] shrink-0 text-muted-foreground'>Subject:</span>
                  <span className='min-w-0 truncate whitespace-nowrap'>{subject}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions + scheduled time — top right */}
          <div className='flex shrink-0 items-start gap-1 self-center'>
            <div className='flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 mr-1 bg-amber-100 dark:bg-amber-950/30 rounded px-1.5 py-0.5'>
              <Clock className='size-3' />
              <span className='font-medium whitespace-nowrap'>
                {formatScheduledTime(new Date(scheduledAt))}
              </span>
            </div>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={(e) => {
                e.stopPropagation()
                onEdit(id)
              }}>
              <Pencil />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              className='text-red-600 hover:text-red-700 dark:text-red-400'
              onClick={(e) => {
                e.stopPropagation()
                onCancel(id)
              }}>
              <X />
            </Button>
          </div>
        </div>
      </div>

      {/* Body content — only when expanded */}
      {expanded && (
        <div className='border-t border-amber-200 dark:border-amber-800'>
          {textHtml ? (
            <div className='p-4'>
              <SandboxedEmailHtml html={textHtml} />
            </div>
          ) : textPlain ? (
            <div className='whitespace-pre-wrap break-words p-4 text-sm dark:text-white'>
              {textPlain}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
