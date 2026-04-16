// apps/web/src/components/calls/ui/speaker-badge.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { RecordBadge, recordBadgeVariants } from '~/components/resources/ui/record-badge'
import type { GetRecordLinkOptions } from '~/components/resources/utils/get-record-link'

interface SpeakerBadgeProps extends VariantProps<typeof recordBadgeVariants> {
  /** When set, renders a RecordBadge for the contact. Otherwise renders the fallback avatar + name. */
  contactRecordId?: RecordId | null
  /** Display name used in the fallback (already resolved by the caller). */
  name: string
  /** Tailwind bg class for the fallback avatar circle (e.g. 'bg-blue-500'). */
  avatarColor: string
  /** Link configuration — forwarded to RecordBadge when contactRecordId is set. */
  link?: boolean | GetRecordLinkOptions
  className?: string
}

function getInitials(name: string): string {
  const first = name.trim()[0]
  return first ? first.toUpperCase() : ''
}

/**
 * Badge for a transcript speaker. Prefers rendering a RecordBadge when the speaker is
 * linked to a contact, otherwise falls back to a colored initials avatar + name using
 * the same recordBadgeVariants styling.
 */
export function SpeakerBadge({
  contactRecordId,
  name,
  avatarColor,
  link,
  variant,
  size,
  className,
}: SpeakerBadgeProps) {
  if (contactRecordId) {
    return (
      <RecordBadge
        recordId={contactRecordId}
        variant={variant}
        size={size}
        link={link}
        className={className}
      />
    )
  }

  const initials = getInitials(name) || '?'
  const avatarSize = size === 'sm' ? 'size-3 text-[8px]' : 'size-4 text-[10px]'

  return (
    <div
      data-slot='speaker-badge'
      className={cn(recordBadgeVariants({ variant, size }), className)}>
      <span
        data-slot='speaker-avatar'
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md font-medium text-white',
          avatarSize,
          avatarColor
        )}>
        {initials}
      </span>
      <span data-slot='record-display' className='truncate'>
        {name}
      </span>
    </div>
  )
}
