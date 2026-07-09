// apps/web/src/components/mail/thread-participant-button.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { User } from 'lucide-react'
import { useQueryState } from 'nuqs'
import * as React from 'react'
import { useThreadCounterparty } from '~/components/mail/hooks'
import { RecordBadge, recordBadgeVariants } from '~/components/resources/ui'
import type { ParticipantMeta } from '~/components/threads/store'

interface ThreadParticipantButtonProps {
  threadId: string
}

/**
 * Compact chip in the thread header showing the thread's counterparty — the
 * earliest EXTERNAL participant, so owner-initiated threads show the recipient
 * rather than the owner (internal-only threads fall back to the first sender).
 * When the thread has more than one external, a `+N` affordance opens a popover
 * listing every external, each clickable into the same drawer.
 *
 * Reads everything from the existing thread stores (`useThreadCounterparty` →
 * `useMessages` + participant store); no extra network call.
 */
export function ThreadParticipantButton({ threadId }: ThreadParticipantButtonProps) {
  const [, setContactId] = useQueryState('contactId', { defaultValue: '' })
  const [, setParticipantId] = useQueryState('participantId', { defaultValue: '' })

  const { primary, others, fallback, isLoading } = useThreadCounterparty(threadId)
  const contact = primary ?? fallback

  const openParticipant = React.useCallback(
    (participant: ParticipantMeta) => {
      if (participant.entityInstanceId) {
        void setParticipantId('')
        void setContactId(participant.entityInstanceId)
      } else {
        void setContactId('')
        void setParticipantId(participant.id)
      }
    },
    [setContactId, setParticipantId]
  )

  if (isLoading && !contact) {
    return (
      <span className={cn(recordBadgeVariants({ variant: 'default' }))}>
        <Skeleton />
        <Skeleton />
      </span>
    )
  }

  if (!contact) return null

  return (
    <span className='flex items-center gap-1'>
      <ParticipantChip participant={contact} onOpen={openParticipant} />
      {others.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={cn(
                recordBadgeVariants({ variant: 'default' }),
                'cursor-pointer text-muted-foreground'
              )}>
              +{others.length}
            </button>
          </PopoverTrigger>
          <PopoverContent align='start' className='flex w-56 flex-col gap-1 p-1'>
            {[primary, ...others]
              .filter((p): p is ParticipantMeta => !!p)
              .map((p) => (
                <ParticipantChip key={p.id} participant={p} onOpen={openParticipant} />
              ))}
          </PopoverContent>
        </Popover>
      )}
    </span>
  )
}

/**
 * A single counterparty chip. Linked contact → `RecordBadge` (opens the contact
 * drawer); unlinked participant → a chip styled with the same `recordBadgeVariants`
 * cva (opens the participant drawer), so the visual stays consistent
 * before/after contact promotion.
 */
function ParticipantChip({
  participant,
  onOpen,
}: {
  participant: ParticipantMeta
  onOpen: (participant: ParticipantMeta) => void
}) {
  if (participant.entityInstanceId) {
    return (
      <button
        type='button'
        onClick={() => onOpen(participant)}
        className='cursor-pointer text-left'>
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
      onClick={() => onOpen(participant)}
      className={cn(recordBadgeVariants({ variant: 'link' }), 'text-left')}>
      <span className='flex size-4 items-center justify-center rounded-full bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200'>
        <User className='size-2.5' />
      </span>
      <span data-slot='record-display' className='truncate'>
        {participant.displayName}
      </span>
    </button>
  )
}
