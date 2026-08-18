// apps/web/src/components/mail/call-display.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { Phone, PhoneMissed, PhoneOutgoing, Voicemail } from 'lucide-react'
import type { ComponentType } from 'react'
import { useMessage, useMessageParticipants } from '~/components/threads/hooks'
import type { AttachmentMeta } from '~/components/threads/store'
import { participantInitials, participantLabel } from '~/components/threads/utils/participant-label'
import { ContactHoverCard } from '../contacts/contact-hover-card'
import { AttachmentDisplay } from '../files/utils/attachment-display'
import { Tooltip } from '../global/tooltip'
import type { EmailActions } from './email-actions'

interface CallDisplayProps {
  /** Message ID to display */
  messageId: string
  /** Actions for this message — mirrors MessageDisplay's prop shape; the call card has no dropdown today. */
  messageActions: EmailActions
  /** Whether message is expanded by default — mirrors MessageDisplay's prop shape; unused (the call card never collapses). */
  isOpen: boolean
}

/**
 * Displays a CALL or VOICEMAIL message as a compact card: state icon + title,
 * duration when known, and any non-inline attachments (voicemail audio, or a
 * later call recording) via `AttachmentDisplay`. Fetches its own data from
 * the message store, same as `MessageDisplay`.
 */
const CallDisplay = ({ messageId }: CallDisplayProps) => {
  const { message, isLoading } = useMessage({ messageId })
  const { from: sender } = useMessageParticipants(message?.participants ?? [])

  if (isLoading) {
    return <CallSkeleton />
  }

  if (!message) {
    return null
  }

  const callMeta = message.callMeta ?? null
  const isVoicemail = message.messageType === 'VOICEMAIL'
  const answered = callMeta?.answered ?? true
  const direction = callMeta?.direction ?? (message.isInbound ? 'incoming' : 'outgoing')

  const { Icon, title }: { Icon: ComponentType<{ className?: string }>; title: string } =
    isVoicemail
      ? { Icon: Voicemail, title: 'Voicemail' }
      : !answered
        ? { Icon: PhoneMissed, title: 'Missed call' }
        : direction === 'outgoing'
          ? { Icon: PhoneOutgoing, title: 'Outgoing call' }
          : { Icon: Phone, title: 'Call' }

  const isInbound = message.isInbound
  const senderName = sender ? participantLabel(sender) : 'Unknown'
  const senderInitials = participantInitials(sender)
  const contactId = sender?.entityInstanceId
  const nonInlineAttachments = (message.attachments ?? []).filter((a) => !a.inline)
  const duration =
    callMeta?.durationSeconds != null ? formatCallDuration(callMeta.durationSeconds) : null

  return (
    <div className='mt-2 flex flex-col'>
      <div className={cn('flex flex-row', isInbound ? 'justify-start' : 'justify-end')}>
        <div className={cn('mt-1 shrink-0', isInbound ? 'order-1' : 'order-3')}>
          <ContactHoverCard contactId={contactId ?? undefined}>
            <Avatar className='h-8 w-8'>
              <AvatarFallback className='bg-foreground/50 text-background hover:bg-foreground/70'>
                {senderInitials}
              </AvatarFallback>
              <AvatarImage src={sender?.avatarUrl ?? undefined} />
            </Avatar>
          </ContactHoverCard>
        </div>

        <div
          className={cn(
            'max-w-lg px-2',
            isInbound ? 'order-2 justify-self-start' : 'order-2 justify-self-end'
          )}>
          <div className='min-h-[70px] min-w-[192px] rounded-2xl border border-black/10 bg-background shadow-xs dark:bg-gray-500'>
            <div className='truncate px-4 py-2'>
              <div className='truncate font-medium text-gray-700 text-sm'>{senderName}</div>
            </div>

            <div className='px-4 pb-3'>
              <div className='flex items-center gap-2 text-foreground text-sm'>
                <Icon className='size-4 shrink-0' />
                <span className='font-medium'>{title}</span>
                {duration && <span className='text-muted-foreground text-xs'>{duration}</span>}
              </div>

              {nonInlineAttachments.length > 0 && (
                <div className='mt-2 flex flex-col gap-1.5'>
                  {nonInlineAttachments.map((a) => (
                    <AttachmentDisplay
                      key={a.id}
                      attachment={toAttachmentInfo(a)}
                      showRemoveButton={false}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={cn(
            'px-1 pt-4 text-gray-500 text-xs font-normal uppercase',
            isInbound ? 'order-3' : 'order-1'
          )}>
          <Tooltip
            content={message.sentAt ? new Date(message.sentAt).toString() : ''}
            delayDuration={0}
            side='top'
            sideOffset={5}
            className='text-muted-foreground text-xs'>
            <span className='shrink-0 whitespace-nowrap'>
              {formatDistanceToNow(message.sentAt ? new Date(message.sentAt) : new Date(), {
                addSuffix: true,
              })}
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

export default CallDisplay

/** Formats seconds as `m:ss` — `125` → `2:05`. Negative/NaN inputs clamp to `0:00`. */
export function formatCallDuration(totalSeconds: number): string {
  const clamped = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Bridge from `AttachmentMeta` (the store's display shape, already loaded for
 * every message) to the `GroupedAttachmentInfo` shape `AttachmentDisplay`
 * expects. Mirrors `chat-message-display.tsx`'s `toAttachmentInfo` — at
 * runtime the component only reads id/name/mimeType/size.
 */
function toAttachmentInfo(a: AttachmentMeta) {
  return {
    id: a.id,
    role: 'ATTACHMENT',
    title: null,
    sort: 0,
    createdAt: new Date(),
    type: 'asset' as const,
    fileId: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size ?? null,
  }
}

function CallSkeleton() {
  return (
    <div className='mt-2 flex flex-col'>
      <div className='flex flex-row justify-start'>
        <Skeleton className='mt-1 h-8 w-8 rounded-full' />
        <div className='max-w-lg px-2'>
          <div className='min-h-[70px] min-w-[192px] space-y-2 rounded-2xl border p-4'>
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-4 w-32' />
          </div>
        </div>
      </div>
    </div>
  )
}
