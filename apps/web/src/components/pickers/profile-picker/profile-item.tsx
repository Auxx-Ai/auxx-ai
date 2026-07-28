// apps/web/src/components/pickers/profile-picker/profile-item.tsx

'use client'

import { CommandDetailItem } from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { Check, HardHat, ShieldCheck, UserCircle2 } from 'lucide-react'
import { seatLabel } from '~/components/members/hooks/use-member-profiles'
import type { PickerProfile, ProfilePickerOption } from './types'

/**
 * A profile's own glyph, or the neutral shield when it has no icon. Exported so
 * a picker trigger can render the selected profile with the same mark its row
 * carries in the list.
 */
export function ProfileGlyph({
  profile,
  className,
}: {
  profile: PickerProfile
  className?: string
}) {
  if (profile.icon) {
    return (
      <EntityIcon
        iconId={profile.icon.iconId}
        color={profile.icon.color}
        size='sm'
        className={className}
      />
    )
  }
  return <ShieldCheck className={cn('size-4 text-muted-foreground', className)} />
}

/** The seat class, inline on the row — never collapsed away (plan 19 §0.22). */
function SeatMark({ seat }: { seat: PickerProfile['seat'] }) {
  const Icon = seat === 'worker' ? HardHat : UserCircle2
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs',
        seat === 'worker' ? 'text-amber-600' : 'text-muted-foreground'
      )}>
      <Icon className='size-3' />
      {seatLabel(seat)}
    </span>
  )
}

interface ProfileItemProps {
  option: ProfilePickerOption
  isSelected: boolean
  onSelect: (profileId: string) => void
  /** Show the seat class inline — member surfaces only; an agent has no seat. */
  showSeat?: boolean
}

/**
 * One profile row in the picker list, on the shared {@link CommandDetailItem}
 * so it matches every other detail picker in the app.
 *
 * A disabled option's `reason` takes the description slot: an admin looking at
 * an option they cannot pick needs the "why" in the same place the description
 * would have been, not hidden behind a separate affordance.
 */
export function ProfileItem({ option, isSelected, onSelect, showSeat }: ProfileItemProps) {
  const { profile, disabled, reason } = option

  return (
    <CommandDetailItem
      value={profile.id}
      onSelect={() => onSelect(profile.id)}
      disabled={disabled}
      icon={<ProfileGlyph profile={profile} />}
      title={profile.name}
      description={reason ?? profile.description ?? undefined}
      secondary={showSeat ? <SeatMark seat={profile.seat} /> : undefined}
      trailing={
        isSelected ? (
          <div className='flex size-4 items-center justify-center rounded-full border border-blue-800 bg-info'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        ) : undefined
      }
    />
  )
}
