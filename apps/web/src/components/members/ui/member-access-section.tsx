// apps/web/src/components/members/ui/member-access-section.tsx
'use client'

import { OrganizationRole as Role } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useGroupsForUser } from '~/components/groups'
import { roleLabel, seatLabel, useAssignProfile, useMemberProfiles } from '../hooks'
import type { Member } from '../types'
import { MemberProfilePicker } from './member-profile-picker'
import { ProfileChangeDelta } from './profile-change-delta'

interface MemberAccessSectionProps {
  member: Member
  viewerRole: OrganizationRole | null | undefined
  viewerId: string | null | undefined
}

/**
 * Member detail's access controls: the ONE permission **profile** (§7). Role is
 * hidden (plan 21 §2.0.1) — the profile's declared rank is the only place a
 * member's governance rank is set, so there is nothing left for a separate Role
 * control to decide.
 *
 * There is no seat control here — moving a member between seat classes is a
 * billing event that lives in the members-list row menu as its own cap-checked
 * action (§0.21).
 *
 * Picking a different profile stages the change and renders the complete
 * effective delta first, so the admin sees the resulting access — including any
 * rank crossing — rather than just a new name.
 */
export function MemberAccessSection({ member, viewerRole, viewerId }: MemberAccessSectionProps) {
  const {
    canManageProfiles,
    isLoading,
    optionsFor,
    resolveMemberProfile,
    profileById,
    raisesFor,
    buildDelta,
  } = useMemberProfiles()
  const { data: groups } = useGroupsForUser(member.userId)
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)

  const { assign, isPending: isAssigning } = useAssignProfile(() => setPendingProfileId(null))

  // §6 mirror of `canManageTarget`, degrade-only — the server re-runs the rank
  // check plus the escalation guard on every write.
  const isSelf = member.userId === viewerId
  const canManageTarget =
    !isSelf &&
    (viewerRole === Role.OWNER || (viewerRole === Role.ADMIN && member.role === Role.USER))
  const canAssign = canManageTarget && canManageProfiles

  const currentProfile = resolveMemberProfile(member)
  const options = useMemo(() => optionsFor(member, viewerRole), [optionsFor, member, viewerRole])
  const selectedId = pendingProfileId ?? currentProfile?.id
  const isReassigning = !!pendingProfileId && pendingProfileId !== currentProfile?.id

  const pendingProfile = pendingProfileId ? profileById.get(pendingProfileId) : undefined

  const raises = useMemo(
    () =>
      raisesFor(
        member.userId,
        (groups ?? []).map((g) => g.id)
      ),
    [raisesFor, member.userId, groups]
  )
  const delta = useMemo(
    () =>
      isReassigning && pendingProfile
        ? buildDelta({
            role: member.role,
            from: currentProfile,
            to: pendingProfile,
            raises,
            seat: member.seatType,
          })
        : null,
    [
      buildDelta,
      member.role,
      member.seatType,
      currentProfile,
      pendingProfile,
      isReassigning,
      raises,
    ]
  )

  const handleApply = async () => {
    if (!pendingProfileId) return
    await assign({ memberId: member.userId, profileId: pendingProfileId })
  }

  // The profile picker is the only control, so its own rank and seat class are
  // stated right under it (§3.0's AFTER sketch) — the picker's rank line, not a
  // separate Role control.
  const currentProfileSummary = currentProfile
    ? `${roleLabel(currentProfile.role)} · ${seatLabel(currentProfile.seat)}`
    : undefined

  return (
    <SettingsSection
      icon={ShieldCheck}
      title='Access'
      description="The profile this member's access composes from">
      <div className='flex flex-col gap-3'>
        <div className='rounded-xl border p-1'>
          <TreeRow
            rowClassName='bg-primary-50 hover:bg-primary-100'
            title='Permission profile'
            description={
              currentProfileSummary ??
              'The base this member starts from. Teams and personal grants raise it.'
            }
            trailing={
              isLoading ? (
                <Skeleton className='h-8 w-56' />
              ) : (
                <MemberProfilePicker
                  options={options}
                  value={selectedId}
                  onChange={setPendingProfileId}
                  disabled={!canAssign || isAssigning}
                />
              )
            }
          />
        </div>

        {!canManageProfiles && (
          <p className='text-xs text-muted-foreground'>
            You need the Permissions capability to change which profile a member is on.
          </p>
        )}
        {isSelf && (
          <p className='text-xs text-muted-foreground'>You cannot change your own profile.</p>
        )}

        {isReassigning && delta && pendingProfile && (
          <>
            <ProfileChangeDelta
              delta={delta}
              from={currentProfile}
              to={pendingProfile}
              seatType={member.seatType}
            />
            <div className='flex items-center justify-end gap-2'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setPendingProfileId(null)}
                disabled={isAssigning}>
                Cancel
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleApply}
                loading={isAssigning}
                loadingText='Applying...'>
                Apply profile
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  )
}
