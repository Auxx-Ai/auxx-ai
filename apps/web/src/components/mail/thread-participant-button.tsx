// apps/web/src/components/mail/thread-participant-button.tsx
'use client'

import { groupParticipantsByRole } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { User } from 'lucide-react'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { RecordBadge, recordBadgeVariants } from '~/components/resources/ui'
import { useMessages, useParticipant } from '~/components/threads/hooks'

interface ThreadParticipantButtonProps {
  threadId: string
}

/**
 * Compact chip in the thread header that opens the thread's primary
 * participant (the `from` of the first message) in a drawer.
 *
 * Routing rule:
 * - Linked contact (`entityInstanceId` set) → opens `?contactId=` and renders
 *   a `RecordBadge` so it matches every other record chip in the app.
 * - No linked contact → opens `?participantId=` and renders a chip styled with
 *   the same `recordBadgeVariants` cva so the visual stays consistent
 *   before/after promotion.
 *
 * Reads everything from the existing thread stores (`useMessages` +
 * `useParticipant`); no extra network call.
 */
export function ThreadParticipantButton({ threadId }: ThreadParticipantButtonProps) {
  const [, setContactId] = useQueryState('contactId', { defaultValue: '' })
  const [, setParticipantId] = useQueryState('participantId', { defaultValue: '' })

  const { messages, isLoading: messagesLoading } = useMessages({ threadId })
  const fromId = React.useMemo(() => {
    const first = messages[0]
    if (!first) return null
    return groupParticipantsByRole(first.participants).from
  }, [messages])

  const { participant } = useParticipant({ participantId: fromId, enabled: !!fromId })

  const handleClick = React.useCallback(() => {
    if (!participant) return
    if (participant.entityInstanceId) {
      void setParticipantId('')
      void setContactId(participant.entityInstanceId)
    } else {
      void setContactId('')
      void setParticipantId(participant.id)
    }
  }, [participant, setContactId, setParticipantId])

  if (messagesLoading && !participant) {
    return (
      <span className={cn(recordBadgeVariants({ variant: 'default' }))}>
        <Skeleton />
        <Skeleton />
      </span>
    )
  }

  if (!participant) return null

  if (participant.entityInstanceId) {
    return (
      <button type='button' onClick={handleClick} className='cursor-pointer'>
        <RecordBadge
          recordId={toRecordId('contact', participant.entityInstanceId)}
          variant='link'
          hoverCard={false}
        />
      </button>
    )
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      className={cn(recordBadgeVariants({ variant: 'link' }))}>
      <span className='flex size-4 items-center justify-center rounded-full bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200'>
        <User className='size-2.5' />
      </span>
      <span data-slot='record-display' className='truncate'>
        {participant.displayName}
      </span>
    </button>
  )
}
