// apps/web/src/components/permissions/ui/profile-list.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { EmptySection } from '@auxx/ui/components/section'
import { Bot, Copy, Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import type { PermissionProfile } from '../hooks/use-profiles'
import { useProfiles } from '../hooks/use-profiles'
import { APPLIES_TO_COPY, DEFAULT_PROFILE_ICON, SEAT_LABEL } from './profile-copy'
import { ProfileCreateDialog } from './profile-create-dialog'

interface ProfileListProps {
  /** The `granularPermissions` plan gate — creating/cloning is a write. */
  canEdit: boolean
  onSelect: (profileId: string) => void
}

/**
 * The Profiles grid (doc 19 §7): every profile in the org as a `ListCard` tile,
 * split by the principal it binds to. People profiles supply the base access a
 * member starts from; agent profiles carry an exact policy that is snapshotted at
 * publish.
 *
 * Each tile states its **seat class** inline (§0.22 — seat is shown, not hidden)
 * because seat is immutable after creation: moving a profile to another seat class
 * is *Duplicate → pick the other seat → reassign*, which is exactly what the
 * Duplicate action starts.
 *
 * Deleting is not offered here — the delete dialog has to show the holder count
 * and the resulting access delta before anything is removed (§0.24).
 */
export function ProfileList({ canEdit, onSelect }: ProfileListProps) {
  const { profiles, isLoading } = useProfiles()
  const [createOpen, setCreateOpen] = useState(false)
  const [cloneFrom, setCloneFrom] = useState<PermissionProfile | null>(null)

  const { memberProfiles, agentProfiles } = useMemo(
    () => ({
      memberProfiles: profiles.filter((p) => p.appliesTo !== 'agent'),
      agentProfiles: profiles.filter((p) => p.appliesTo === 'agent'),
    }),
    [profiles]
  )

  const openCreate = () => {
    setCloneFrom(null)
    setCreateOpen(true)
  }

  const openClone = (profile: PermissionProfile) => {
    setCloneFrom(profile)
    setCreateOpen(true)
  }

  const renderCard = (profile: PermissionProfile) => {
    const icon = profile.icon ?? DEFAULT_PROFILE_ICON
    return (
      <ListCard
        key={profile.id}
        icon={<EntityIcon iconId={icon.iconId} color={icon.color} size='sm' />}
        title={profile.name}
        subtitle={profile.slug}
        description={profile.description ?? APPLIES_TO_COPY[profile.appliesTo].description}
        badges={renderBadgeChips([
          {
            label: SEAT_LABEL[profile.seat],
            variant: profile.seat === 'worker' ? 'amber' : 'gray',
            description:
              profile.seat === 'worker'
                ? 'Assignable to field seats only. Seat class is fixed at creation.'
                : 'Assignable to full seats only. Seat class is fixed at creation.',
          },
          { label: APPLIES_TO_COPY[profile.appliesTo].label },
          ...(profile.isSystem
            ? [{ label: 'System', description: 'Seeded template. Not deletable.' }]
            : []),
        ])}
        menuItems={
          canEdit
            ? [
                {
                  label: 'Duplicate',
                  icon: <Copy />,
                  onClick: () => openClone(profile),
                },
              ]
            : undefined
        }
        onClick={() => onSelect(profile.id)}
        ariaLabel={`Edit ${profile.name}`}
      />
    )
  }

  return (
    <div className='flex flex-1 flex-col gap-8 p-3 sm:p-6'>
      <SettingsSection
        icon={Users}
        title='People profiles'
        description='A profile supplies the base access a member starts from. Every member resolves to one: explicitly assigned, or the system profile for their role and seat.'>
        {isLoading ? (
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            <ListCard loading />
            <ListCard loading />
            <ListCard loading />
          </div>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {memberProfiles.map(renderCard)}
            {canEdit && (
              <ListCard
                variant='placeholder'
                classNames={{ icon: 'border-dashed' }}
                icon={<Plus />}
                title='New profile'
                subtitle='Pick a seat class'
                description='Create a profile, then set its base access. Seat class and principal type are fixed once it exists.'
                onClick={openCreate}
              />
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        icon={Bot}
        title='Agent profiles'
        description='Agent profiles carry an exact policy (None, Read, Read + Write, or Full) that is snapshotted onto the agent version at publish. Editing one changes draft agents; production changes only on the next publish.'>
        {agentProfiles.length === 0 ? (
          <EmptySection
            orientation='horizontal'
            icon={<Bot />}
            title='No agent profiles'
            description='Every org is seeded with an internal-agent and a customer-facing chat-agent profile.'
          />
        ) : (
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {agentProfiles.map(renderCard)}
          </div>
        )}
      </SettingsSection>

      <ProfileCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        cloneFrom={cloneFrom}
        onCreated={onSelect}
      />
    </div>
  )
}
