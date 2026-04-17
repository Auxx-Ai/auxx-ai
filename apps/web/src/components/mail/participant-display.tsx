// apps/web/src/components/mail/participant-display.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { titleize } from '@auxx/utils/strings'
import { useQueryState } from 'nuqs'
import React from 'react'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'
import { useParticipant } from '~/components/threads/hooks'
import type { ParticipantMeta } from '~/components/threads/store'

/** Role types for message participants */
type ParticipantRole = 'FROM' | 'TO' | 'CC' | 'BCC'

/**
 * Props for ParticipantDisplay component.
 * Supports hybrid pattern: pass either participantId (will fetch) or participant object (uses directly).
 */
interface ParticipantDisplayProps {
  /** Participant ID to fetch from store */
  participantId?: string | null
  /** Pre-fetched participant object (skips fetch if provided) */
  participant?: ParticipantMeta
  /** Role of this participant in the message */
  role?: ParticipantRole
  /** Additional CSS classes */
  className?: string
  /** Control whether to show the email/phone details */
  showDetails?: boolean
}

/**
 * Displays a single participant with name and optional contact details.
 * Supports both fetching by ID or using a pre-provided participant object.
 */
export const ParticipantDisplay: React.FC<ParticipantDisplayProps> = ({
  participantId,
  participant: providedParticipant,
  role,
  className,
  showDetails = true,
}) => {
  // Fetch from store only if participant object not provided
  const { participant: fetchedParticipant, isLoading } = useParticipant({
    participantId: providedParticipant ? null : participantId,
    enabled: !providedParticipant && !!participantId,
  })

  const participant = providedParticipant ?? fetchedParticipant
  const isPrimary = role === 'FROM'

  const [activeContactId, setContactId] = useQueryState('contactId', { defaultValue: '' })

  /** Handle click to select/deselect contact */
  function handleContactClick(e: React.MouseEvent) {
    e.stopPropagation()
    const contactId = participant?.entityInstanceId
    if (!contactId) return
    const isAlreadySelected = contactId === activeContactId
    setContactId(isAlreadySelected ? '' : contactId)
  }

  // Loading state
  if (isLoading && !participant) {
    return <ParticipantSkeleton />
  }

  // No participant found
  if (!participant) {
    return null
  }

  const { identifier, identifierType, name, displayName, entityInstanceId } = participant
  const displayLabel = displayName || name || identifier

  return (
    <div className={cn('flex gap-2 truncate text-sm', isPrimary && 'font-medium', className)}>
      <ContactHoverCard contactId={entityInstanceId ?? undefined}>
        <button
          onClick={handleContactClick}
          className={cn('text-foreground cursor-pointer hover:text-blue-500')}>
          {displayLabel}
        </button>
      </ContactHoverCard>

      {showDetails &&
        (identifierType === 'EMAIL' ? (
          <span className='text-muted-foreground hidden sm:block'>{identifier}</span>
        ) : (
          <span className='text-muted-foreground hidden sm:block'>
            {formatPhoneNumber(identifier)}
          </span>
        ))}
    </div>
  )
}

/**
 * Format phone number for display.
 */
function formatPhoneNumber(phone: string): string {
  if (phone?.startsWith('+')) {
    const digits = phone.substring(1)
    if (digits.length >= 10) {
      const countryCode = digits.slice(0, digits.length - 10)
      const areaCode = digits.slice(digits.length - 10, digits.length - 7)
      const firstPart = digits.slice(digits.length - 7, digits.length - 4)
      const lastPart = digits.slice(digits.length - 4)
      return `+${countryCode} (${areaCode}) ${firstPart}-${lastPart}`
    }
  }
  return phone
}

/**
 * Loading skeleton for participant.
 */
function ParticipantSkeleton() {
  return <Skeleton className='h-4 w-24' />
}

/**
 * Entry for a participant in a list.
 * Supports both legacy MessageParticipant format and new ID-based format.
 */
export interface ParticipantListEntry {
  /** Unique key for this entry */
  id: string
  /** Participant ID */
  participantId: string
  /** Role of this participant */
  role: ParticipantRole
  /** Pre-fetched participant data (optional, will fetch if not provided) */
  participant?: ParticipantMeta
}

/**
 * Props for ParticipantList component.
 */
interface ParticipantListProps {
  /** Array of participant entries */
  participants: ParticipantListEntry[]
  /** Additional CSS classes */
  className?: string
}

/**
 * Displays a list of participants with their roles.
 */
export const ParticipantList: React.FC<ParticipantListProps> = ({ participants, className }) => {
  const [showDetails, setShowDetails] = React.useState(false)

  // Group participants by role, preserving display order
  const grouped = React.useMemo(() => {
    const roleOrder: ParticipantRole[] = ['FROM', 'TO', 'CC', 'BCC']
    const map = new Map<ParticipantRole, ParticipantListEntry[]>()
    for (const entry of participants) {
      const list = map.get(entry.role) ?? []
      list.push(entry)
      map.set(entry.role, list)
    }
    return roleOrder
      .filter((role) => map.has(role))
      .map((role) => ({ role, entries: map.get(role)! }))
  }, [participants])

  if (!participants.length) return null

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    setShowDetails(true)
  }

  return (
    <div onClick={handleClick}>
      {grouped.map(({ role, entries }) => (
        <div className={cn('flex flex-row gap-1', className)} key={role}>
          <span className='mr-[4px] shrink-0 text-sm text-muted-foreground'>{titleize(role)}:</span>
          <div className='flex flex-wrap gap-x-1 gap-y-0.5'>
            {entries.map((entry, i) => (
              <React.Fragment key={entry.id}>
                <ParticipantDisplay
                  participantId={entry.participantId}
                  participant={entry.participant}
                  role={entry.role}
                  showDetails={showDetails}
                />
                {i < entries.length - 1 && <span className='text-muted-foreground text-sm'>,</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
