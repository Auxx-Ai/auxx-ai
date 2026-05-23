// apps/web/src/components/mail/chat-visitor-sidebar.tsx
'use client'

import { formatVisitorLabel } from '@auxx/lib/chat/labels'
import { Separator } from '@auxx/ui/components/separator'
import { User } from 'lucide-react'

interface ChatThreadMetadata {
  channel?: 'chat'
  channelId?: string
  visitorParticipantId?: string
  visit?: {
    userAgent?: string
    ipAddress?: string
    referrer?: string
    url?: string
  }
  claimedVisitorEmail?: string
  claimedVisitorName?: string
  visitorLabel?: string
}

/**
 * Visitor-context panel rendered on chat threads. Reads `Thread.metadata` —
 * the chat metadata populated when a visitor initializes a session. Null on
 * non-chat threads (the caller should not render this then).
 */
export function ChatVisitorSidebar({ metadata }: { metadata: ChatThreadMetadata }) {
  const visit = metadata.visit ?? {}
  return (
    <aside className='w-64 shrink-0 space-y-3 overflow-y-auto border-l bg-muted/30 p-4 text-xs'>
      <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
        <User size={16} /> Visitor
      </h3>
      <div className='space-y-1.5'>
        <p>
          <strong className='font-medium'>Name:</strong>{' '}
          {metadata.claimedVisitorName || (
            <span className='italic text-muted-foreground'>Not provided</span>
          )}
        </p>
        <p>
          <strong className='font-medium'>Email:</strong>{' '}
          {metadata.claimedVisitorEmail ? (
            <a
              href={`mailto:${metadata.claimedVisitorEmail}`}
              className='text-primary-500 hover:underline'>
              {metadata.claimedVisitorEmail}
            </a>
          ) : (
            <span className='italic text-muted-foreground'>Not provided</span>
          )}
        </p>
        {metadata.visitorParticipantId && (
          <p title={metadata.visitorParticipantId}>
            <strong className='font-medium'>Visitor ID:</strong>{' '}
            <span className='text-muted-foreground'>
              {metadata.visitorLabel ?? formatVisitorLabel(metadata.visitorParticipantId)}
            </span>
          </p>
        )}
      </div>

      <Separator />

      <div className='space-y-1.5'>
        {visit.url && (
          <p>
            <strong className='font-medium'>Page:</strong>{' '}
            <a
              href={visit.url}
              target='_blank'
              rel='noopener noreferrer'
              className='block truncate text-primary hover:underline'
              title={visit.url}>
              {visit.url}
            </a>
          </p>
        )}
        {visit.referrer && (
          <p>
            <strong className='font-medium'>Referrer:</strong>{' '}
            <span className='block truncate text-muted-foreground' title={visit.referrer}>
              {visit.referrer}
            </span>
          </p>
        )}
        {visit.userAgent && (
          <p>
            <strong className='font-medium'>User agent:</strong>{' '}
            <span className='block truncate text-muted-foreground' title={visit.userAgent}>
              {visit.userAgent}
            </span>
          </p>
        )}
        {visit.ipAddress && (
          <p>
            <strong className='font-medium'>IP:</strong>{' '}
            <span className='font-mono text-muted-foreground'>{visit.ipAddress}</span>
          </p>
        )}
      </div>
    </aside>
  )
}

/**
 * Narrow `Thread.metadata` to chat-shaped metadata. Returns null when the
 * thread has no metadata or the metadata is for a different channel.
 */
export function asChatThreadMetadata(
  metadata: Record<string, unknown> | null | undefined
): ChatThreadMetadata | null {
  if (!metadata) return null
  const m = metadata as ChatThreadMetadata
  if (m.channel !== 'chat') return null
  return m
}
