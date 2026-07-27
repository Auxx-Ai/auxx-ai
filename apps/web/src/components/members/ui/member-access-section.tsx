// apps/web/src/components/members/ui/member-access-section.tsx
'use client'

import { OrganizationRole as Role } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useGroupsForUser } from '~/components/groups'
import { api } from '~/trpc/react'
import { useAssignProfile, useMemberProfiles } from '../hooks'
import type { Member } from '../types'
import { MemberProfilePicker } from './member-profile-picker'
import { ProfileChangeDelta } from './profile-change-delta'

interface MemberAccessSectionProps {
  member: Member
  viewerRole: OrganizationRole | null | undefined
  viewerId: string | null | undefined
}

const ROLE_COPY: Record<string, string> = {
  [Role.OWNER]:
    'Full control of the organization, and the only role that can promote another Owner.',
  [Role.ADMIN]: 'Manages organization settings and members, but cannot delete the organization.',
  [Role.USER]: 'Standard member. What they can reach comes from their permission profile.',
}

/**
 * Member detail's access controls: the governance **rank** (Role) and the ONE
 * permission **profile** (§7).
 *
 * There is no seat control here — moving a member between seat classes is a
 * billing event that lives in the members-list row menu as its own cap-checked
 * action (§0.21).
 *
 * Picking a different profile stages the change and renders the complete
 * effective delta first, so the admin sees the resulting access rather than just
 * a new name.
 */
export function MemberAccessSection({ member, viewerRole, viewerId }: MemberAccessSectionProps) {
  const utils = api.useUtils()
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
  const updateRole = api.member.updateRole.useMutation({
    onSuccess: () => {
      void utils.member.all.invalidate()
    },
    onError: (error) => toastError({ title: 'Error updating role', description: error.message }),
  })

  // §6 mirror of `canManageTarget`, degrade-only — the server re-runs the rank
  // check plus the escalation guard on every write.
  const isSelf = member.userId === viewerId
  const canManageTarget =
    !isSelf &&
    (viewerRole === Role.OWNER || (viewerRole === Role.ADMIN && member.role === Role.USER))
  const canAssign = canManageTarget && canManageProfiles

  const currentProfile = resolveMemberProfile(member)
  const options = useMemo(() => optionsFor(member), [optionsFor, member])
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

  // A field seat is always a Member (`seatType='worker' ⇒ role='USER'`), so the
  // promotion rungs are unreachable until the seat changes.
  const seatBlocksPromotion = member.seatType === 'worker'

  const handleApply = async () => {
    if (!pendingProfileId) return
    await assign({ memberId: member.userId, profileId: pendingProfileId })
  }

  return (
    <SettingsSection
      icon={ShieldCheck}
      title='Role and profile'
      description='The governance rank this member holds, and the profile their access composes from'>
      <div className='flex flex-col gap-3'>
        <div className='rounded-xl border p-1'>
          <TreeRow
            rowClassName='bg-primary-50 hover:bg-primary-100'
            title='Role'
            description={ROLE_COPY[member.role]}
            trailing={
              <Select
                value={member.role}
                disabled={!canManageTarget || updateRole.isPending}
                onValueChange={(role: OrganizationRole) =>
                  updateRole.mutate({ memberId: member.userId, role })
                }>
                <SelectTrigger className='min-w-40'>
                  <SelectValue placeholder='Select a role' />
                </SelectTrigger>
                <SelectContent>
                  {viewerRole === Role.OWNER && (
                    <SelectItem
                      value={Role.OWNER}
                      disabled={seatBlocksPromotion}
                      description={
                        seatBlocksPromotion
                          ? 'Field seats are always Members. Change the seat first.'
                          : undefined
                      }>
                      Owner
                    </SelectItem>
                  )}
                  <SelectItem
                    value={Role.ADMIN}
                    disabled={seatBlocksPromotion}
                    description={
                      seatBlocksPromotion
                        ? 'Field seats are always Members. Change the seat first.'
                        : undefined
                    }>
                    Admin
                  </SelectItem>
                  <SelectItem value={Role.USER}>Member</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <TreeRow
            rowClassName='bg-primary-50 hover:bg-primary-100'
            title='Permission profile'
            description='The base this member starts from. Teams and personal grants raise it.'
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
          <p className='text-xs text-muted-foreground'>
            You cannot change your own role or profile.
          </p>
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
