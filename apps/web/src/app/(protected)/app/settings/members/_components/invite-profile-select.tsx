// apps/web/src/app/(protected)/app/settings/members/_components/invite-profile-select.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { api } from '~/trpc/react'

/** The subset of a permission profile the invite flow needs. */
export interface InvitableProfileOption {
  id: string
  slug: string
  name: string
  description: string | null
  /** Declared seat class — drives the cap check and the accepted member's seat. */
  seat: SeatType
}

/**
 * Seat class label. The DB value stays `'worker'`; the label is always
 * "Field seat" (§11.1). Shown inline on every profile option — seat class is
 * shown, not hidden (§0.22).
 */
export function seatClassLabel(seat: SeatType): string {
  return seat === 'worker' ? 'Field seat' : 'Full seat'
}

/**
 * Permission profiles that may be offered at invite time: every profile in the
 * org except agent-only ones (`appliesTo: 'agent'`), which can never apply to a
 * human member.
 *
 * `listProfiles` is gated on the `permissions` area, so an inviter who can manage
 * members but cannot read permissions gets no list. That is not an error state —
 * the caller hides the control and the invitation is created with no binding,
 * which resolves to the system template for the invited role (§1.3).
 */
export function useInvitableProfiles() {
  const { data, isLoading, isError } = api.permissions.listProfiles.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  })

  const profiles: InvitableProfileOption[] = (data ?? [])
    .filter((profile) => profile.appliesTo !== 'agent')
    .map((profile) => ({
      id: profile.id,
      slug: profile.slug,
      name: profile.name,
      description: profile.description,
      seat: profile.seat,
    }))

  return { profiles, isLoading, isError }
}

/** The profile an invite form should start on: the plain Member baseline. */
export function defaultInviteProfile(
  profiles: InvitableProfileOption[]
): InvitableProfileOption | undefined {
  return profiles.find((profile) => profile.slug === 'member') ?? profiles[0]
}

interface InviteProfileSelectProps {
  /** Selected profile id (controlled). */
  value: string | undefined
  /** Fires with the whole profile so the caller can react to its seat class. */
  onChange: (profile: InvitableProfileOption) => void
  profiles: InvitableProfileOption[]
  disabled?: boolean
}

/**
 * Profile picker for the invite flow — replaces the seat toggle (§4.2). The
 * chosen profile declares the seat class, so there is nothing left for a
 * separate seat control to decide; the role select stays, since role is the
 * governance rank, not a capability shape.
 */
export function InviteProfileSelect({
  value,
  onChange,
  profiles,
  disabled,
}: InviteProfileSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(id) => {
        const profile = profiles.find((candidate) => candidate.id === id)
        if (profile) onChange(profile)
      }}
      disabled={disabled || profiles.length === 0}>
      <SelectTrigger>
        <SelectValue placeholder='Select a permission profile' />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          // `description` renders OUTSIDE Radix's ItemText, so it stays in the
          // dropdown instead of being copied into the trigger.
          <SelectItem
            key={profile.id}
            value={profile.id}
            description={profile.description ?? undefined}>
            <span className='flex items-center gap-2'>
              <span className='font-medium'>{profile.name}</span>
              <span className='text-muted-foreground text-xs'>{seatClassLabel(profile.seat)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
