// apps/web/src/components/members/ui/member-profile-picker.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat, ShieldCheck, UserCircle2 } from 'lucide-react'
import type { ProfileOption } from '../hooks'
import { seatLabel } from '../hooks'

interface MemberProfilePickerProps {
  /** Every profile in the org with its seat verdict — mismatches stay listed. */
  options: ProfileOption[]
  /** The bound (or pending) profile id. */
  value: string | undefined
  onChange: (profileId: string) => void
  disabled?: boolean
  className?: string
  id?: string
}

/** The seat class, inline on the option — never collapsed away (§0.22). */
function SeatMark({ seat }: { seat: ProfileOption['profile']['seat'] }) {
  const Icon = seat === 'worker' ? HardHat : UserCircle2
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        seat === 'worker' ? 'text-amber-600' : 'text-muted-foreground'
      )}>
      <Icon className='size-3' />
      {seatLabel(seat)}
    </span>
  )
}

/**
 * The ONE profile picker for a member (§0.4) — the replacement for
 * `seat-type-select.tsx` (§4.2).
 *
 * Every profile in the org is listed. A profile whose declared `seat` does not
 * match the member's billed seat is rendered **disabled with the reason inline**
 * rather than hidden (§0.21): picking it could only be honoured by moving the
 * member between seat classes, which assignment must never do — that is a
 * billing event, and it lives in the members-list row menu as its own
 * cap-checked action. Every option carries its seat class inline (§0.22).
 *
 * One picker, one profile — a member binds exactly one, and it supplies only the
 * base they compose up from (§0.3/§0.14; the authored ceiling was removed in
 * plan 20).
 */
export function MemberProfilePicker({
  options,
  value,
  onChange,
  disabled = false,
  className,
  id,
}: MemberProfilePickerProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn('min-w-56', className)}>
        <SelectValue placeholder='Select a profile' />
      </SelectTrigger>
      <SelectContent>
        {options.map(({ profile, disabled: optionDisabled, reason }) => (
          <SelectItem
            key={profile.id}
            value={profile.id}
            disabled={optionDisabled}
            description={reason ?? profile.description ?? undefined}>
            <span className='inline-flex items-center gap-1.5'>
              {profile.icon?.iconId ? (
                <EntityIcon
                  iconId={profile.icon.iconId}
                  color={profile.icon.color}
                  variant='bare'
                  size='xs'
                />
              ) : (
                <ShieldCheck className='size-3.5 text-muted-foreground' />
              )}
              <span>{profile.name}</span>
              <SeatMark seat={profile.seat} />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
