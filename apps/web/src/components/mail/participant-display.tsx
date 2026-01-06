import { titleize } from '@auxx/utils/strings'
import { useQueryState } from 'nuqs'
import React from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { ContactHoverCard } from '~/components/contacts/contact-hover-card'

interface Participant {
  id: string
  identifier: string
  identifierType: 'EMAIL' | 'PHONE'
  name?: string
  displayName?: string
  initials?: string
  isSpammer?: boolean
  contactId?: string
}
interface MessageParticipant {
  id: string
  messageId: string
  participantId: string
  role: 'FROM' | 'TO' | 'CC' | 'BCC'
  participant: Participant
}

interface ParticipantDisplayProps {
  participant: MessageParticipant
  className?: string
  showDetails?: boolean // Control whether to show the email/phone details
  // isPrimary?: boolean // To style differently if it's the main participant
}

export const ParticipantDisplay: React.FC<ParticipantDisplayProps> = ({
  participant,
  className,
  showDetails = true,
  // isPrimary = false,
}) => {
  const { identifier, identifierType, name, displayName, contactId, contact } =
    participant.participant
  const isPrimary = participant.role === 'FROM' // Example condition to determine primary

  // Import the useSearchParams hook from Next.js
  const [activeContactId, setContactId] = useQueryState('contactId', { defaultValue: '' })

  // Use display name or name or fallback to first part of identifier
  const displayLabel = displayName || name || identifier

  const formatPhoneNumber = (phone: string) => {
    // Basic E.164 formatting - can be enhanced based on regional preferences
    if (phone?.startsWith('+')) {
      // Try to format like: +1 (555) 123-4567
      const digits = phone.substring(1)
      if (digits.length >= 10) {
        const countryCode = digits.slice(0, digits.length - 10)
        const areaCode = digits.slice(digits.length - 10, digits.length - 7)
        const firstPart = digits.slice(digits.length - 7, digits.length - 4)
        const lastPart = digits.slice(digits.length - 4)
        return `+${countryCode} (${areaCode}) ${firstPart}-${lastPart}`
      }
    }
    // Fallback to original format if can't parse
    return phone
  }

  function handleContactClick(e: React.MouseEvent) {
    e.stopPropagation()
    // If the participant is already selected, deselect it, otherwise select it
    const isAlreadySelected = contactId === activeContactId
    setContactId(isAlreadySelected ? '' : contactId || '')
  }

  return (
    <div className={cn('flex gap-2 truncate text-sm', isPrimary && 'font-medium', className)}>
      <ContactHoverCard contact={contact}>
        <button
          onClick={handleContactClick}
          className={cn('text-foreground cursor-pointer hover:text-blue-500')}>
          {displayLabel}
        </button>
      </ContactHoverCard>

      {showDetails &&
        (identifierType === 'EMAIL' ? (
          <span className="text-muted-foreground">{identifier}</span>
        ) : (
          <span className="text-muted-foreground">{formatPhoneNumber(identifier)}</span>
        ))}
    </div>
  )
}

// Usage example with multiple participants
export const ParticipantList: React.FC<{
  participants: MessageParticipant[]
  // role?: string // 'FROM', 'TO', 'CC', etc.
  // label?: string // Custom label
  className?: string
}> = ({ participants, className }) => {
  if (!participants.length) return null
  const [showDetails, setShowDetails] = React.useState(false)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    e.stopPropagation()
    setShowDetails(true)
  }
  return (
    <div onClick={(e: React.MouseEvent<HTMLDivElement>) => handleClick(e)}>
      {participants.map((participant) => {
        return (
          <div className={cn('flex flex-row gap-1', className)} key={participant.id}>
            {participant.role && (
              <span className="mr-[4px] shrink-0 text-sm text-muted-foreground">
                {titleize(participant.role)}:
              </span>
            )}
            <div className="flex flex-wrap gap-x-2 gap-y-1 truncate">
              <ParticipantDisplay
                key={participant.id}
                participant={participant}
                showDetails={showDetails} // Hide details for the list
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
