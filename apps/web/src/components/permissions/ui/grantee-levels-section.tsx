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

/** Neutral copy for a grantee kind this section does not model (e.g. `profile`). */
const FALLBACK_DESCRIPTION =
  'What this grantee can do across the workspace. Overrides only raise access above the member baseline.'

/**
 * Total copy lookup — `COPY[granteeKind].description` on an unlisted kind is a
 * `TypeError` at render, and this section is the whole Permissions tab of a
 * member/team detail page.
 */
function descriptionFor(granteeKind: string): string {
  return COPY[granteeKind as GranteeKind]?.description ?? FALLBACK_DESCRIPTION
}

/**
 * Agent copy. Agents compose by SET over an all-Full base — no baseline, no
 * inheritance — so the surface is a restriction editor, not an elevation one.
 */
const AGENT_DESCRIPTION =
  'What this agent can reach when it runs. An area you leave on Default gives the agent full access — set a lower level (or None) to restrict it.'

/**
 * The Layer-2 (per-area None/Read/Edit/Full) override editor for a single grantee
 * — a member or a team — surfaced on their detail page's Permissions tab. Reuses
 * the org-wide {@link usePermissionGrants} store and renders one grantee's sparse
 * level map through {@link LeveledAreaGrid} in `override` mode: every area
 * inherits the effective member baseline and can only be *raised* above it
 * (raise-only enforced server-side; an override that lifts nothing is flagged
 * "ignored"). Sits above the Layer-3 Record-access grid, which overrides the
 * Records area per record type.
 *
 * `mode='agent'` retargets the same store at an AGENT grantee (the agent's
 * backing `userId`, still a `user`-type grant row): the grid switches to
 * SET-semantics — unset ⇒ **Full**, `None` is a real rung, nothing is "ignored"
 * — per capability layer v2 §0.2/§0.3. The write path is identical either way,
 * and it is what keeps the two states apart: an unset area OMITS its key from
 * the saved map (compose falls through to Full), while `None` writes an explicit
 * `Level.None` (kept server-side for AGENT grantees, stripped for humans).
 */
export function GranteeLevelsSection({
  granteeKind,
  granteeId,
  canEdit,
  mode = 'override',
}: {
  granteeKind: GranteeKind
  granteeId: string
  canEdit: boolean
  /** `override` — a member/team grant; `agent` — an agent's own profile. */
  mode?: 'override' | 'agent'
}) {
  const { isLoading, roleDefaults, effectiveBaseline, groupGrants, userGrants, save } =
    usePermissionGrants()

  const persisted = granteeKind === 'group' ? groupGrants : userGrants
  const values = persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}

  const handleChange = (area: Area, level: Level | undefined) => {
    const next = { ...values }
    // `undefined` DELETES the key (no grant → the grantee's fall-through: the
    // baseline for a member, Full for an agent); an explicit level — including
    // `Level.None`, which is `0` and must not be conflated with absent — is
    // stored as-is.
    if (level === undefined) delete next[area]
    else next[area] = level
    save(granteeKind, granteeId, next)
  }

  return (
    <SettingsSection
      icon={SlidersHorizontal}
      title='Access levels'
      description={mode === 'agent' ? AGENT_DESCRIPTION : descriptionFor(granteeKind)}>
      {isLoading || !roleDefaults ? (
        <div className='space-y-2'>
          <Skeleton className='h-16 w-full rounded-lg' />
          <Skeleton className='h-16 w-full rounded-lg' />
        </div>
      ) : (
        <LeveledAreaGrid
          mode={mode}
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
