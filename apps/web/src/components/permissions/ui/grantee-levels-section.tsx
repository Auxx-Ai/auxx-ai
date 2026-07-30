// apps/web/src/components/permissions/ui/grantee-levels-section.tsx
'use client'

import { Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SlidersHorizontal } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { FormSaveBar } from '~/components/global/forms/form-save-bar'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { useGranteeAccess } from '../hooks/use-grantee-access'
import { useGranteeAreaLevels } from '../hooks/use-grantee-area-levels'
import { type GranteeKind, useGranteeDefAccess } from '../hooks/use-grantee-def-access'
import { useInstanceGranteeRows } from '../hooks/use-instance-grantee-rows'
import { useRoleDefaults } from '../hooks/use-permission-grants'
import { mergeStaged } from '../hooks/use-staged-edits'
import { GranteeDefAccessRows } from './grantee-def-access-rows'
import { GranteeInstanceRows } from './grantee-instance-rows'
import { AREA_TO_INSTANCE_KEY, deadGrantWarning } from './instance-share-copy'
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
 * The Layer-2 (per-area None/Read/Edit/Full) override editor for a single grantee
 * — a member or a team — surfaced on their detail page's Permissions tab.
 *
 * Reads ONE grantee (plan 31 §2.4): `useGranteeAccess` supplies this grantee's
 * own area levels, the Member profile's baseline and the composed `effective`
 * line. It used to read the org-wide `usePermissionGrants` store — every grant
 * row in the org — and pick this grantee's out client-side. That hook survives
 * for the surfaces that genuinely are org-wide; only the role defaults
 * ({@link useRoleDefaults}) are still shared with it.
 *
 * Renders that sparse level map through {@link LeveledAreaGrid} in
 * `override` mode: every area
 * inherits the effective member baseline and can only be *raised* above it
 * (raise-only enforced server-side; an override that lifts nothing is flagged
 * "ignored"). Sits above the Layer-3 Record-access grid, which overrides the
 * Records area per record type.
 *
 * All three surfaces here — area levels, per-def overrides, per-instance grants
 * — **stage** their edits and commit from one {@link FormSaveBar}
 * ({@link useGranteeAreaLevels}, `useStagedEdits`). This is the same grid the
 * permissions page's overrides tab renders, so the two had to move together.
 */
export function GranteeLevelsSection({
  granteeKind,
  granteeId,
  canEdit,
}: {
  granteeKind: MemberOrGroup
  granteeId: string
  canEdit: boolean
}) {
  const { roleDefaults, isLoading: roleDefaultsLoading } = useRoleDefaults()
  // One grantee, not the org (plan 31 §2.4). `useGranteeDefAccess` and
  // `useInstanceGranteeRows` below run the same query — React Query dedupes it,
  // so all three read one request. `effective` is null for a team, which is
  // exactly when the area line must not render.
  const {
    isLoading: granteeLoading,
    own,
    baseline,
    effective,
  } = useGranteeAccess(granteeKind, granteeId)

  // Memoized: both feed `renderChildren`'s dependency list, and a fresh object
  // each render would rebuild every nested grid on every keystroke in the
  // grid's search box.
  const persistedLevels = useMemo(() => own?.areas ?? {}, [own])
  /** The org-wide member baseline per area — role default merged with org policy. */
  const effectiveBaseline = useMemo(
    () => ({ ...(roleDefaults ?? {}), ...(baseline?.areas ?? {}) }),
    [roleDefaults, baseline]
  )
  const isLoading = roleDefaultsLoading || granteeLoading

  const areaLevels = useGranteeAreaLevels(granteeKind, granteeId, persistedLevels)
  const defAccess = useGranteeDefAccess(granteeKind, granteeId)
  const instanceRows = useInstanceGranteeRows(granteeKind, granteeId)
  const { isLoading: defAccessLoading, rows: defRows, setLevel: setDefLevel } = defAccess
  const {
    isLoading: instanceRowsLoadingAll,
    lists: instanceLists,
    rowsByKey: instanceRowsByKey,
    setGrant: setInstanceGrant,
  } = instanceRows
  const values = areaLevels.values

  // Area levels first: they are the base every nested def/instance row is
  // measured against, so a half-applied save leaves the coarser value written and
  // the finer one still staged, not the other way round.
  const staged = mergeStaged([areaLevels, defAccess, instanceRows])
  const [confirmDiscard, ConfirmDialog] = useConfirm()

  const handleDiscard = async () => {
    const confirmed = await confirmDiscard({
      title: 'Discard changes?',
      description: 'Your unsaved access changes will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) staged.discard()
  }

  /**
   * Per-def overrides nested under Records (capability layer v2 Part B.0), and
   * per-instance grants nested under Datasets / Knowledge base / Dashboards
   * (Part B) — the grantee-scoped twin of the Workspace defaults tab's own
   * per-def / per-instance rows. "Overrides only" means "has an explicit grant for this
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
          rows: <GranteeDefAccessRows rows={matched} canEdit={canEdit} onChange={setDefLevel} />,
        }
      }

      const instanceKey = AREA_TO_INSTANCE_KEY[area]
      if (!instanceKey) return undefined

      // This grantee's composed level for the area shown right above these
      // rows, re-derived with the same fall-through `LeveledAreaGrid`'s
      // `override` mode uses — so the dead-grant warning needs no extra server
      // call (§B.2.8).
      const areaLevel =
        values[area] ?? effectiveBaseline[area] ?? roleDefaults?.[area] ?? Level.None

      const instanceLoading = instanceRowsLoadingAll || instanceLists[instanceKey].isLoading
      if (instanceLoading)
        return {
          matchCount: 0,
          rows: (
            <GranteeInstanceRows
              rows={[]}
              isLoading
              canEdit={canEdit}
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
            truncated={instanceLists[instanceKey].truncated}
            canEdit={canEdit}
            deadGrantTooltip={
              granteeKind === 'user' && areaLevel === Level.None
                ? deadGrantWarning(PERMISSION_AREAS[area].label)
                : undefined
            }
            onChange={setInstanceGrant}
          />
        ),
      }
    },
    [
      defAccessLoading,
      defRows,
      canEdit,
      setDefLevel,
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
    <>
      <ConfirmDialog />
      <SettingsSection
        icon={SlidersHorizontal}
        title='Access levels'
        description={descriptionFor(granteeKind)}>
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
            onChange={areaLevels.setLevel}
            disabled={!canEdit}
            renderChildren={renderChildren}
            effectiveLevels={effective?.areas}
          />
        )}
      </SettingsSection>

      {/* A fragment, not a child of the section: the bar pins to the bottom of
          the page's scroll viewport, not inside the card. */}
      <FormSaveBar
        dirty={staged.isDirty}
        isSaving={staged.isSaving}
        onSave={() => void staged.save()}
        onDiscard={() => void handleDiscard()}
        label='Unsaved access changes'
        saveDisabled={!canEdit}
      />
    </>
  )
}
