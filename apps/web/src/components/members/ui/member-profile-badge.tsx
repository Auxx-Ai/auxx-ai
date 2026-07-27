// apps/web/src/components/members/ui/member-profile-badge.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat, ShieldCheck } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { MemberProfile } from '../hooks'
import { seatLabel } from '../hooks'

interface MemberProfileBadgeProps {
  /** The member's effective profile — bound, or the resolved system template. */
  profile: MemberProfile | undefined
  /** The member's billed seat, used for the field-seat marker beside the name. */
  seatType: SeatType
  className?: string
}

/**
 * The profile-name badge that replaces `SeatTypeBadge` on the member card,
 * members tab and member detail (§4.2). The seat class does not disappear with
 * it — a field seat keeps its own marker beside the name (§0.22 / §4.1: seat
 * stays visible on the picker and the seat-change control, and the field seat is
 * the exceptional, billed case worth reading at a glance).
 *
 * Renders nothing when the profile cannot be resolved (a viewer without
 * `permissions.manage` never loads the profile list) except for a field seat,
 * whose marker is independent of the profile.
 */
export function MemberProfileBadge({ profile, seatType, className }: MemberProfileBadgeProps) {
  const fieldSeat =
    seatType === 'worker' ? (
      <Tooltip content='Billed as a field seat: schedule and assigned jobs only.'>
        <Badge variant='amber' size='xs' className='gap-1'>
          <HardHat />
          <span>{seatLabel(seatType)}</span>
        </Badge>
      </Tooltip>
    ) : null

  if (!profile) return fieldSeat

  return (
    <>
      <Tooltip
        content={
          profile.description ??
          `${profile.name}: the access this member composes from (${seatLabel(profile.seat)}).`
        }>
        <Badge variant='secondary' size='xs' className={cn('gap-1', className)}>
          {profile.icon?.iconId ? (
            <EntityIcon
              iconId={profile.icon.iconId}
              color={profile.icon.color}
              variant='bare'
              size='xs'
            />
          ) : (
            <ShieldCheck />
          )}
          <span>{profile.name}</span>
        </Badge>
      </Tooltip>
      {fieldSeat}
    </>
  )
}
