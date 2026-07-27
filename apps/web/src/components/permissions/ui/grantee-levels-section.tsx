// apps/web/src/components/permissions/ui/grantee-levels-section.tsx
'use client'

import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SlidersHorizontal } from 'lucide-react'
import { useCallback } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { type GranteeKind, useGranteeDefAccess } from '../hooks/use-grantee-def-access'
import { useInstanceGranteeRows } from '../hooks/use-instance-grantee-rows'
import { usePermissionGrants } from '../hooks/use-permission-grants'
import { GranteeDefAccessRows } from './grantee-def-access-rows'
import { GranteeInstanceRows } from './grantee-instance-rows'
import { AREA_TO_INSTANCE_KEY } from './instance-share-copy'
import { type AreaChildFilter, type AreaChildren, LeveledAreaGrid } from './leveled-area-grid'

/**
 * This section's own grantee axis — a member or a team, never a profile: it
 * writes through `usePermissionGrants().save`, whose `GrantGranteeType` input
 * deliberately excludes `'profile'` (a profile's own area levels are authored
 * on the Profiles page, not raised as an override here). Narrower than the
 * shared {@link GranteeKind} on purpose — `useGranteeDefAccess` /
 * `useInstanceGranteeRows` both accept the wider union, so a `MemberOrGroup`
 * value passes through them fine.
 */
type MemberOrGroup = Exclude<GranteeKind, 'profile'>

const COPY: Partial<Record<GranteeKind, { description: string }>> = {
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
  'What this agent can reach when it runs. An area you leave on Default gives the agent full access. Set a lower level (or None) to restrict it.'

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
  granteeKind: MemberOrGroup
  granteeId: string
  canEdit: boolean
  /** `override` — a member/team grant; `agent` — an agent's own profile. */
  mode?: 'override' | 'agent'
}) {
  const { isLoading, roleDefaults, effectiveBaseline, groupGrants, userGrants, save } =
    usePermissionGrants()

  const persisted = granteeKind === 'group' ? groupGrants : userGrants
  const values = persisted.find((g) => g.granteeId === granteeId)?.levels ?? {}

  const principal = mode === 'agent' ? 'agent' : 'member'
  const {
    isLoading: defAccessLoading,
    rows: defRows,
    setLevel: setDefLevel,
  } = useGranteeDefAccess(granteeKind, granteeId, principal)
  const {
    isLoading: instanceRowsLoadingAll,
    lists: instanceLists,
    rowsByKey: instanceRowsByKey,
    setGrant: setInstanceGrant,
  } = useInstanceGranteeRows(granteeKind, granteeId)

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

  /**
   * Per-def overrides nested under Records (capability layer v2 Part B.0), and
   * per-instance grants nested under Datasets / Knowledge base / Dashboards
   * (Part B) — the grantee-scoped twin of `MemberBaselineTab`'s
   * `renderChildren`. "Overrides only" means "has an explicit grant for this
   * grantee"; a def/instance-name match keeps (and expands) the parent area
   * row even when the area label itself didn't match.
   */
  const renderChildren = useCallback(
    (area: Area, filter: AreaChildFilter): AreaChildren | undefined => {
      if (area === Area.records) {
        if (defAccessLoading)
          return {
            matchCount: 0,
            rows: (
              <GranteeDefAccessRows rows={[]} isLoading canEdit={canEdit} onChange={setDefLevel} />
            ),
          }

        const matched = defRows.filter((row) => {
          if (filter.overridesOnly && row.grantLevel === undefined) return false
          if (!filter.query) return true
          const { plural, label } = row.resource
          return (
            plural.toLowerCase().includes(filter.query) ||
            label.toLowerCase().includes(filter.query)
          )
        })

        return {
          matchCount: matched.length,
          rows: (
            <GranteeDefAccessRows
              rows={matched}
              canEdit={canEdit}
              principal={principal}
              onChange={setDefLevel}
            />
          ),
        }
      }

      const instanceKey = AREA_TO_INSTANCE_KEY[area]
      if (!instanceKey) return undefined

      // This grantee's composed level for the area shown right above these
      // rows, re-derived with the same fall-through `LeveledAreaGrid` uses for
      // this `mode` — so the dead-grant warning needs no extra server call
      // (§B.2.8). Agents compose by SET over an all-Full base (no baseline).
      const areaLevel =
        mode === 'agent'
          ? (values[area] ?? Level.Full)
          : (values[area] ?? effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None)

      const instanceLoading = instanceRowsLoadingAll || instanceLists[instanceKey].isLoading
      if (instanceLoading)
        return {
          matchCount: 0,
          rows: (
            <GranteeInstanceRows
              rows={[]}
              isLoading
              canEdit={canEdit}
              isUser={granteeKind === 'user'}
              areaLevel={areaLevel}
              areaLabel=''
              onChange={setInstanceGrant}
            />
          ),
        }

      const matched = instanceRowsByKey[instanceKey].filter((row) => {
        if (filter.overridesOnly && row.grantLevel === undefined) return false
        if (!filter.query) return true
        return row.name.toLowerCase().includes(filter.query)
      })

      return {
        matchCount: matched.length,
        rows: (
          <GranteeInstanceRows
            rows={matched}
            canEdit={canEdit}
            isUser={granteeKind === 'user'}
            areaLevel={areaLevel}
            areaLabel={PERMISSION_AREAS[area].label}
            onChange={setInstanceGrant}
          />
        ),
      }
    },
    [
      defAccessLoading,
      defRows,
      canEdit,
      principal,
      setDefLevel,
      mode,
      values,
      effectiveBaseline,
      roleDefaults,
      instanceRowsLoadingAll,
      instanceLists,
      instanceRowsByKey,
      granteeKind,
      setInstanceGrant,
    ]
  )

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
          renderChildren={renderChildren}
        />
      )}
    </SettingsSection>
  )
}
