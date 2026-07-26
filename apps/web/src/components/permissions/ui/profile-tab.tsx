// apps/web/src/components/permissions/ui/profile-tab.tsx
'use client'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { useQueryState } from 'nuqs'
import { useEffect } from 'react'
import { useProfiles } from '../hooks/use-profiles'
import { ProfileEditor } from './profile-editor'
import { ProfileList } from './profile-list'

/**
 * The **Profiles** tab of Settings → Permissions (doc 19 §7): the profile grid,
 * drilling into one profile's editor. The selection lives in the `p` query param
 * so a refresh, a back button, or a shared link lands on the same profile.
 *
 * `disabled` is the `granularPermissions` plan gate. Reads are never gated (§0.26)
 * — a Free org still sees the system profiles supplying its access — so an
 * un-entitled org gets the full read-only surface rather than a hidden tab.
 */
export function ProfilesTab({ disabled = false }: { disabled?: boolean }) {
  const [profileId, setProfileId] = useQueryState('p')
  const { profiles, isLoading } = useProfiles()

  const selected = profiles.find((p) => p.id === profileId)

  // A selection that survived a delete (or a hand-edited URL) falls back to the
  // list instead of rendering an empty editor.
  useEffect(() => {
    if (!profileId || isLoading || selected) return
    void setProfileId(null)
  }, [profileId, isLoading, selected, setProfileId])

  if (profileId && !selected && isLoading) {
    return (
      <div className='space-y-2 p-3 sm:p-6'>
        <Skeleton className='h-24 w-full rounded-lg' />
        <Skeleton className='h-24 w-full rounded-lg' />
      </div>
    )
  }

  if (selected) {
    return (
      <ProfileEditor
        key={selected.id}
        profile={selected}
        canEdit={!disabled}
        onBack={() => void setProfileId(null)}
      />
    )
  }

  return <ProfileList canEdit={!disabled} onSelect={(id) => void setProfileId(id)} />
}
