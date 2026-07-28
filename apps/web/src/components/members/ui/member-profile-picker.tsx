// apps/web/src/components/members/ui/member-profile-picker.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  type SelectTriggerProps,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat, ShieldCheck, UserCircle2 } from 'lucide-react'
import type { ProfileOption } from '../hooks'
import { seatLabel } from '../hooks'

interface MemberProfilePickerProps {
  /** The profiles bindable to this member, already seat-filtered by `optionsFor`. */
  options: ProfileOption[]
  /** The bound (or pending) profile id. */
  value: string | undefined
  onChange: (profileId: string) => void
  disabled?: boolean
  className?: string
  id?: string
  /** Trigger styling — `transparent` for pickers that sit inside a filled row. */
  variant?: SelectTriggerProps['variant']
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
 * Only profiles from the member's own seat class are listed — `optionsFor` drops
 * the rest, since picking one could only be honoured by moving the member
 * between seat classes, which assignment must never do (that is a billing event,
 * and it lives in the members-list row menu as its own cap-checked action). The
 * exception `optionsFor` keeps is the member's own binding when it mismatches:
 * that arrives `disabled` with the reason inline, so the picker still shows what
 * they are on. Every option carries its seat class inline (§0.22).
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
  variant,
}: MemberProfilePickerProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} variant={variant} className={cn('min-w-56', className)}>
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
