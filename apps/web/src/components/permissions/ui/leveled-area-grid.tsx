// apps/web/src/components/permissions/ui/leveled-area-grid.tsx
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { AlertTriangle, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { AreaAccessRow, hasAreaAccessRow } from './area-access-row'
import { clampToArea, LevelControl } from './level-control'
import { effectiveLevelLabel } from './level-labels'
import { PROFILE_AREA_GROUPS } from './profile-copy'
import { RungBadge } from './rung-badge'

/** The grid's live filter, handed to {@link LeveledAreaGridProps.renderChildren}. */
export interface AreaChildFilter {
  /** Lower-cased search query, or `''` when the area's own label already matched. */
  query: string
  /** The "Overrides only" toggle — for children, "has a stored value of its own". */
  overridesOnly: boolean
}

/** What an area's nested rows contribute to the grid. */
export interface AreaChildren {
  /**
   * How many children survive the filter. A non-zero count keeps a parent whose
   * own label misses the search query — and auto-expands it.
   */
  matchCount: number
  /** The rendered child rows (already narrowed by the filter). */
  rows: ReactNode
}

/** One area row that survived the filter, with its resolved children. */
interface AreaRow {
  area: Area
  children: AreaChildren | undefined
  /** Only the children matched the search → open the row so they're visible. */
  autoOpen: boolean
}

interface LeveledAreaGridProps {
  /** Explicitly-stored levels for this grantee (sparse — absent areas inherit). */
  values: Partial<Record<Area, Level>>
  /** The USER role's per-area defaults — the informational fall-through baseline. */
  roleDefaults: Record<Area, Level>
  /**
   * Override mode: the effective member baseline per area. Each area inherits from
   * this instead of the raw role default; overrides only take effect above it.
   */
  baseline?: Partial<Record<Area, Level>>
  /**
   * `baseline` — the org-wide member baseline (raise or lower from role default);
   * `override` — a group/user grant that can only raise above the baseline.
   */
  mode: 'baseline' | 'override'
  onChange: (area: Area, level: Level | undefined) => void
  disabled?: boolean
  /**
   * Render nested child rows under an area (only `records` supplies them today —
   * its per-def workspace baselines). Return `undefined` for areas without
   * children. The grid hands over its live {@link AreaChildFilter} so children
   * narrow with the parent, and uses the returned `matchCount` to keep and
   * auto-expand a parent whose own label doesn't match the search.
   */
  renderChildren?: (area: Area, filter: AreaChildFilter) => AreaChildren | undefined
  /**
   * What this grantee can ACTUALLY reach per area — `CapabilitySet.areaLevel`,
   * from `permissions.granteeAccess` (plan 31 §2.4).
   *
   * **Optional, and absent means today's behaviour** — the profile editor
   * renders `ProfileAreaGrid`, not this component, and a group/profile has no
   * effective access to report, so those surfaces simply pass nothing.
   *
   * Why this exists: the ladder shows `values[area] ?? inherited`, where
   * `inherited` is the member profile's base. Real composition is
   * `min(min(max(profileBase, maxOverGroups, userLevel), profileCeiling), seatCeiling)`
   * — so the row displays the first and last terms of that `max` and NEITHER
   * clamp. A member raised by a team reads "Inherit · No access" here while
   * reaching the area fine. Same class as plan 31 finding 4, one level up; the
   * plan names it only for instance rows.
   */
  effectiveLevels?: Partial<Record<Area, Level>>
}

/**
 * The shared leveled surface: every grantable area rendered as a labelled row
 * with its {@link LevelControl}, grouped by registry group (Records,
 * Automation, …). `adminOnly` areas are never shown — they're not grantable below
 * ADMIN. In `override` mode each area inherits from the member baseline (and is
 * raise-only, enforced server-side); in `baseline` mode it inherits from the role
 * default. Every rung is selectable in either mode — an override that doesn't
 * lift the baseline is composed away and flagged as "ignored" on the grantee.
 *
 * **Except the eight instance-access areas** (plan 43 decision 0.7), which render
 * a controlless header with the resolved rung as text and carry their control in
 * an {@link AreaAccessRow} nested beneath it. The set is derived from
 * `INSTANCE_ACCESS_RESOURCES`, so this grid and `ProfileAreaGrid` cannot convert
 * different areas. `Area.records` keeps its ladder on purpose (§5.2): its children
 * are per-*definition* and its rung genuinely IS their default.
 *
 * An area may also nest child rows via `renderChildren` (the member baseline
 * supplies per-def workspace baselines under Records). Children are collapsed by
 * default and participate in the search: a def name keeps its parent row visible
 * and expands it. The access row sits ahead of them and never counts toward
 * `matchCount` — it writes `values[area]`, which "Overrides only" already reads.
 */
export function LeveledAreaGrid({
  values,
  roleDefaults,
  baseline,
  mode,
  onChange,
  disabled = false,
  renderChildren,
  effectiveLevels,
}: LeveledAreaGridProps) {
  const [search, setSearch] = useState('')
  const [overridesOnly, setOverridesOnly] = useState(false)
  /** Explicit expand state per area; absent = follow `autoOpen`. */
  const [openAreas, setOpenAreas] = useState<Partial<Record<Area, boolean>>>({})

  const query = search.trim().toLowerCase()

  /**
   * Groups with their areas narrowed by the search query and the "overrides only"
   * toggle, each carrying its resolved children. An area survives when it matches
   * itself OR one of its children does; the latter also auto-expands it.
   */
  const filteredGroups = useMemo(() => {
    const groups: Array<{ group: string; rows: AreaRow[] }> = []
    for (const { group, areas } of PROFILE_AREA_GROUPS) {
      const rows: AreaRow[] = []
      for (const area of areas) {
        const meta = PERMISSION_AREAS[area]
        const selfMatch =
          !query ||
          meta.label.toLowerCase().includes(query) ||
          meta.description.toLowerCase().includes(query)
        // A parent that matched by its own label shows all of its children;
        // otherwise the query narrows them and a survivor rescues the parent.
        const children = renderChildren?.(area, { query: selfMatch ? '' : query, overridesOnly })
        const childMatch = (children?.matchCount ?? 0) > 0
        if (overridesOnly && values[area] === undefined && !childMatch) continue
        if (!selfMatch && !childMatch) continue
        rows.push({ area, children, autoOpen: !selfMatch && childMatch })
      }
      if (rows.length > 0) groups.push({ group, rows })
    }
    return groups
  }, [query, overridesOnly, values, renderChildren])

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search areas...'
        />
        <ButtonSwitch
          label='Overrides only'
          checked={overridesOnly}
          onCheckedChange={setOverridesOnly}
          disabled={disabled}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<SlidersHorizontal />}
          title='No matches'
          description='No access areas match your search.'
        />
      ) : (
        <div className='flex flex-col gap-4'>
          {filteredGroups.map(({ group, rows }) => (
            <div key={group} className='flex flex-col gap-0.5'>
              <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
              {rows.map(({ area, children, autoOpen }) => {
                const meta = PERMISSION_AREAS[area]
                const value = values[area]
                const inherited =
                  mode === 'override'
                    ? (baseline?.[area] ?? roleDefaults[area])
                    : roleDefaults[area]
                const isOpen = openAreas[area] ?? autoOpen
                const effective = effectiveLevels?.[area]
                // Plan 43 decision 0.7 — the eight instance-access areas trade
                // their ladder for a controlless header plus an access child
                // row. Derived from the registry, never listed, so this grid and
                // `ProfileAreaGrid` cannot drift into converting different sets.
                const hasAccessRow = hasAreaAccessRow(area)
                const accessRow = hasAccessRow ? (
                  <AreaAccessRow
                    area={area}
                    value={value}
                    inheritedLevel={inherited}
                    disabled={disabled}
                    onChange={(level) => onChange(area, level)}
                  />
                ) : null
                const expandable = accessRow !== null || children !== undefined
                return (
                  <TreeRow
                    rowClassName='bg-primary-50 hover:bg-primary-100'
                    key={area}
                    title={meta.label}
                    description={meta.description}
                    // Unconditional, like the instance rows: every area states
                    // what this grantee can ACTUALLY reach, not only the ones
                    // where composition disagrees with the ladder. Showing it
                    // only on disagreement made the line's absence ambiguous —
                    // a reader could not tell "the ladder is the truth here"
                    // from "this surface never reports effective access" (it
                    // doesn't for teams, which have none). Agreement is a
                    // confirmation worth reading; the discrepancies — a group
                    // raise, a profile ceiling, the seat clamp — still stand out
                    // against the rung the control shows.
                    secondary={
                      effective !== undefined ? (
                        <span className='whitespace-nowrap text-xs'>
                          Effective · {effectiveLevelLabel(effective)}
                        </span>
                      ) : undefined
                    }
                    expandable={expandable}
                    isOpen={expandable ? isOpen : undefined}
                    onToggleOpen={
                      expandable
                        ? () => setOpenAreas((prev) => ({ ...prev, [area]: !isOpen }))
                        : undefined
                    }
                    // §2.1b — the collapsed header still states its resolved
                    // rung, as text. On this grid it reads beside the
                    // `Effective · …` line above, which is the composed answer
                    // including group raises and both clamps; this one is what
                    // the row itself authors.
                    actions={
                      hasAccessRow ? (
                        <>
                          {/*
                            The "ignored" warning is `LevelControl`'s, and the
                            eight converted rows no longer have one — but the
                            state it reports is real and raise-only-specific (an
                            override at or below the baseline is composed away
                            server-side and the row would otherwise look like it
                            did something). It moves here rather than to the
                            access child row: it is a statement about this
                            grantee's override versus the member baseline, which
                            is what the HEADER is about.
                          */}
                          {mode === 'override' && value !== undefined && value <= inherited ? (
                            <Tooltip content='This override is ignored. The member baseline already grants this level of access.'>
                              <AlertTriangle className='size-3.5 text-amber-500' />
                            </Tooltip>
                          ) : null}
                          <RungBadge level={clampToArea(meta, value ?? inherited)} />
                        </>
                      ) : undefined
                    }
                    trailing={
                      hasAccessRow ? undefined : (
                        <LevelControl
                          area={meta}
                          value={value}
                          inherited={inherited}
                          ignored={mode === 'override' && value !== undefined && value <= inherited}
                          onChange={(level) => onChange(area, level)}
                          disabled={disabled}
                        />
                      )
                    }>
                    {accessRow}
                    {children?.rows}
                  </TreeRow>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
