// apps/web/src/components/permissions/ui/grantee-levels-section.tsx
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SlidersHorizontal } from 'lucide-react'
import { SettingsSection } from '~/components/global/settings-page'
import type { GranteeKind } from '../hooks/use-grantee-def-access'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import { LeveledAreaGrid } from './leveled-area-grid'

const COPY: Record<GranteeKind, { description: string }> = {
  user: {
    description:
      'What this member can do across the workspace. Overrides only raise access above the member baseline; admins always have full access.',
  },
  group: {
    description:
      'What members of this team can do across the workspace. Overrides only raise access above the member baseline.',
  },
}

/**
 * The Layer-2 (per-area None/Read/Edit/Full) override editor for a single grantee
 * — a member or a team — surfaced on their detail page's Permissions tab. Reuses
 * the org-wide {@link usePermissionGrants} store and renders one grantee's sparse
 * level map through {@link LeveledAreaGrid} in `override` mode: every area
 * inherits the effective member baseline and can only be *raised* above it
 * (raise-only enforced server-side; an override that lifts nothing is flagged
 * "ignored"). Sits above the Layer-3 Record-access grid, which overrides the
 * Records area per record type.
 */
export function GranteeLevelsSection({
  granteeKind,
  granteeId,
  canEdit,
}: {
  granteeKind: GranteeKind
  granteeId: string
  canEdit: boolean
}) {
  const { isLoading, roleDefaults, effectiveBaseline, groupGrants, userGrants, save } =
    usePermissionGrants()

  const persisted = granteeKind === 'group' ? groupGrants : userGrants
  const values = persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}

  const handleChange = (area: Area, level: Level | undefined) => {
    const next = { ...values }
    if (level === undefined) delete next[area]
    else next[area] = level
    save(granteeKind, granteeId, next)
  }

  return (
    <SettingsSection
      icon={SlidersHorizontal}
      title='Access levels'
      description={COPY[granteeKind].description}>
      {isLoading || !roleDefaults ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full rounded-lg' />
          <Skeleton className='h-16 w-full rounded-lg' />
        </div>
      ) : (
        <LeveledAreaGrid
          mode='override'
          values={values}
          roleDefaults={roleDefaults}
          baseline={effectiveBaseline}
          onChange={handleChange}
          disabled={!canEdit}
        />
      )}
    </SettingsSection>
  )
}
