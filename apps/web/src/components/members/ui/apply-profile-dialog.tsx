// apps/web/src/components/members/ui/apply-profile-dialog.tsx
'use client'

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { type MemberProfile, seatLabel, useMemberProfiles } from '../hooks'
import type { Member } from '../types'
import { MemberProfilePicker } from './member-profile-picker'
import { ProfileChangeDelta } from './profile-change-delta'

interface ApplyProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The selected members this applies to — already narrowed to manageable rows. */
  members: Member[]
  /** The signed-in member's role — caps which profiles' ranks are offered (§2.a.9). */
  viewerRole: OrganizationRole | null | undefined
  onApply: (profileId: string) => void
  isApplying: boolean
}

/**
 * Bulk **Apply profile** from the members list (§7).
 *
 * A profile declares its seat class and assignment can never change a member's
 * seat (§0.21), so a mixed-seat selection has no valid target: rather than
 * silently skipping the members that do not match, the dialog refuses and says
 * why. Within a matching selection the delta is shown per distinct current
 * profile, so an admin applying one profile to a mixed-profile group still sees
 * every access change it causes.
 */
export function ApplyProfileDialog({
  open,
  onOpenChange,
  members,
  viewerRole,
  onApply,
  isApplying,
}: ApplyProfileDialogProps) {
  const { optionsFor, resolveMemberProfile, profileById } = useMemberProfiles()
  const [profileId, setProfileId] = useState<string | undefined>(undefined)

  // Never carry a stale selection into a fresh open.
  useEffect(() => {
    if (!open) setProfileId(undefined)
  }, [open])

  const seats = useMemo(() => new Set(members.map((m) => m.seatType)), [members])
  const mixedSeats = seats.size > 1
  const seat = members[0]?.seatType ?? 'full'

  const options = useMemo(
    () => (members[0] ? optionsFor(members[0], viewerRole) : []),
    [optionsFor, members[0], viewerRole]
  )
  const targetProfile = profileId ? profileById.get(profileId) : undefined

  /** The distinct profiles being replaced, with how many members are on each. */
  const groups = useMemo(() => {
    const byFrom = new Map<string, { from: MemberProfile | undefined; count: number }>()
    for (const member of members) {
      const from = resolveMemberProfile(member)
      const key = from?.id ?? 'none'
      const entry = byFrom.get(key)
      if (entry) entry.count += 1
      else byFrom.set(key, { from, count: 1 })
    }
    return [...byFrom.values()]
  }, [members, resolveMemberProfile])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='md'>
        <DialogHeader>
          <DialogTitle>Apply permission profile</DialogTitle>
          <DialogDescription>
            {members.length} selected {members.length === 1 ? 'member' : 'members'}
            {!mixedSeats && ` · ${seatLabel(seat)}`}
          </DialogDescription>
        </DialogHeader>

        {mixedSeats ? (
          <div className='flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <span>
              The selection mixes full seats and field seats. A profile declares its seat class and
              applying one can never move a member between classes, so select members that share a
              seat, or change a seat first from the row menu.
            </span>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <MemberProfilePicker
              options={options}
              value={profileId}
              onChange={setProfileId}
              disabled={isApplying}
            />

            {targetProfile &&
              groups.map(({ from, count }) => (
                <GroupDelta
                  key={from?.id ?? 'none'}
                  from={from}
                  count={count}
                  to={targetProfile}
                  seat={seat}
                />
              ))}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isApplying}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            size='sm'
            variant='outline'
            disabled={mixedSeats || !targetProfile || isApplying}
            loading={isApplying}
            loadingText='Applying...'
            onClick={() => profileId && onApply(profileId)}>
            Apply profile <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The delta for one "currently on X" cohort.
 *
 * Raises are left out here: the bulk selection has no single set of team grants,
 * and both sides of a per-member delta share them anyway. Composition is purely
 * additive, so a base-only delta can only overstate a drop that a member's own
 * grants would hold up — never understate one.
 */
function GroupDelta({
  from,
  count,
  to,
  seat,
}: {
  from: MemberProfile | undefined
  count: number
  to: MemberProfile
  seat: SeatType
}) {
  const { buildDelta } = useMemberProfiles()
  const delta = buildDelta({ role: 'USER', from, to, raises: [], seat })

  return (
    <div className='flex flex-col gap-1'>
      <span className='text-xs text-muted-foreground'>
        {count} {count === 1 ? 'member' : 'members'} currently on{' '}
        <span className='font-medium text-foreground'>{from?.name ?? 'no profile'}</span>
      </span>
      <ProfileChangeDelta delta={delta} from={from} to={to} seatType={seat} />
    </div>
  )
}
