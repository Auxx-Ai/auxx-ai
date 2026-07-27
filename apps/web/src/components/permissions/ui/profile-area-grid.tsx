// apps/web/src/components/permissions/ui/profile-area-grid.tsx
'use client'

import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { type Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Lock, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { LevelControl } from './level-control'
import type { AreaChildFilter, AreaChildren } from './leveled-area-grid'
import {
  PROFILE_AREA_GROUPS,
  UNSET_HINT_BY_ROLE,
  WORKER_LOCK_REASON,
  WORKER_SEAT_AREAS,
} from './profile-copy'

interface ProfileAreaGridProps {
  /**
   * The profile's per-area BASE — what holders start with. Sparse: an absent area
   * falls through to `baseLevel` and then `ROLE_DEFAULTS`.
   */
  values: Partial<Record<Area, Level>>
  /**
   * The USER role's code defaults — the final fall-through when neither an
   * explicit level nor a `baseLevel` is set. Always the USER map, whatever this
   * profile's own `role` is: an ADMIN/OWNER profile carries an explicit
   * `baseLevel` of Full (plan 21 §2.a.7), so it never actually reaches this rung
   * — see `profileRole` below for what the empty-state LABEL should say instead.
   */
  roleDefaults: Record<Area, Level>
  /** The profile's blanket rung for unset areas, or `null`. */
  baseLevel?: Level | null
  /** Drives the §0.19 field-seat lock — a worker profile cannot author non-worker areas. */
  seat: SeatType
  /**
   * The profile's own declared rank (plan 21 §2.a.8) — names the real
   * fall-through source in the "Not set" hint instead of hardcoding USER's.
   * Defaults to `USER`, which is every custom profile (§2.0.1).
   */
  profileRole?: OrganizationRole
  onChange: (area: Area, level: Level | undefined) => void
  disabled?: boolean
  /**
   * Render nested child rows under an area — Records → this profile's per-def
   * overrides, Datasets / Knowledge base / Dashboards → this profile's
   * per-instance grants (capability layer v2 Part B, extended to the profile
   * editor: "expand Records and set the permissions for Companies", combined
   * into this same grid rather than a separate section). Mirrors
   * `LeveledAreaGrid`'s `renderChildren` contract exactly — same
   * {@link AreaChildFilter}/{@link AreaChildren} shape, same search/auto-expand
   * behavior — even though this grid predates and isn't built on
   * `LeveledAreaGrid` (its three-state Not-set/explicit/Locked row is its own
   * thing; only the nesting mechanism is shared).
   */
  renderChildren?: (area: Area, filter: AreaChildFilter) => AreaChildren | undefined
}

/** Why one row is not editable, or `null` when it is. */
function lockReasonFor(area: Area, seat: SeatType): string | null {
  if (seat === 'worker' && !WORKER_SEAT_AREAS.has(area)) return WORKER_LOCK_REASON
  return null
}

/**
 * The profile-side leveled area grid — three states per row, which is the whole
 * point of this component existing beside the shared `LeveledAreaGrid`:
 *
 * 1. **Not set** — no stored entry. The control renders muted with an explicit
 *    `Not set · <source>` hint and highlights the level the area falls through to
 *    (`baseLevel` when the profile sets one, else the member default). Absence is
 *    never rendered as an explicit value.
 * 2. **An explicit level** — every rung is selectable, `None` included. `None` is
 *    `0`, a real rung, and the only way a profile says *no access*; it must never
 *    be filtered out of the ladder or displayed as "inherit" (doc 16 §10's
 *    `POSITIVE_LEVELS` bug, one screen over).
 * 3. **Locked** — a field seat can never reach a non-worker area (§0.19: the
 *    editor refuses to author a contradiction with `SEAT_CEILINGS`). Locked rows
 *    render disabled at the level that actually applies, with the reason on hover.
 *
 * An area may also nest child rows via `renderChildren` — Records → this
 * profile's per-def overrides, Datasets / Knowledge base / Dashboards → this
 * profile's per-instance grants (capability layer v2 Part B, extended here so
 * "expand Records, set Companies" lives in this same grid rather than a
 * separate section). Children are collapsed by default and participate in the
 * search, exactly like `LeveledAreaGrid`'s area rows.
 */
export function ProfileAreaGrid({
  values,
  roleDefaults,
  baseLevel = null,
  seat,
  profileRole = 'USER',
  onChange,
  disabled = false,
  renderChildren,
}: ProfileAreaGridProps) {
  const [search, setSearch] = useState('')
  const [configuredOnly, setConfiguredOnly] = useState(false)
  /** Explicit expand state per area; absent = follow the row's `autoOpen`. */
  const [openAreas, setOpenAreas] = useState<Partial<Record<Area, boolean>>>({})
  const query = search.trim().toLowerCase()

  /**
   * Groups with their areas narrowed by the search query and the "set areas
   * only" toggle, each carrying its resolved children — same shape as
   * `LeveledAreaGrid`'s `filteredGroups`: an area survives when it matches
   * itself OR one of its children does, and the latter also auto-expands it.
   */
  const groups = useMemo(() => {
    const out: Array<{
      group: string
      rows: Array<{ area: Area; children: AreaChildren | undefined; autoOpen: boolean }>
    }> = []
    for (const { group, areas } of PROFILE_AREA_GROUPS) {
      const rows: Array<{ area: Area; children: AreaChildren | undefined; autoOpen: boolean }> = []
      for (const area of areas) {
        const meta = PERMISSION_AREAS[area]
        const selfMatch =
          !query ||
          meta.label.toLowerCase().includes(query) ||
          meta.description.toLowerCase().includes(query)
        // A parent that matched by its own label shows all of its children;
        // otherwise the query narrows them and a survivor rescues the parent.
        const children = renderChildren?.(area, {
          query: selfMatch ? '' : query,
          overridesOnly: configuredOnly,
        })
        const childMatch = (children?.matchCount ?? 0) > 0
        if (configuredOnly && values[area] === undefined && !childMatch) continue
        if (!selfMatch && !childMatch) continue
        rows.push({ area, children, autoOpen: !selfMatch && childMatch })
      }
      if (rows.length > 0) out.push({ group, rows })
    }
    return out
  }, [query, configuredOnly, values, renderChildren])

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search areas...'
        />
        <ButtonSwitch
          label='Set areas only'
          checked={configuredOnly}
          onCheckedChange={setConfiguredOnly}
        />
      </div>

      {groups.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<SlidersHorizontal />}
          title='No matches'
          description='No access areas match your search.'
        />
      ) : (
        <div className='flex flex-col gap-4'>
          {groups.map(({ group, rows }) => (
            <div key={group} className='flex flex-col gap-0.5'>
              <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
              {rows.map(({ area, children, autoOpen }) => {
                const isOpen = openAreas[area] ?? autoOpen
                return (
                  <ProfileAreaRow
                    key={area}
                    area={area}
                    value={values[area]}
                    roleDefault={roleDefaults[area]}
                    baseLevel={baseLevel}
                    seat={seat}
                    profileRole={profileRole}
                    disabled={disabled}
                    onChange={(level) => onChange(area, level)}
                    childRows={children?.rows}
                    isOpen={isOpen}
                    onToggleOpen={
                      children !== undefined
                        ? () => setOpenAreas((prev) => ({ ...prev, [area]: !isOpen }))
                        : undefined
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** One area row: label + description, the lock flag, and the three-state control. */
function ProfileAreaRow({
  area,
  value,
  roleDefault,
  baseLevel,
  seat,
  profileRole,
  disabled,
  onChange,
  childRows,
  isOpen,
  onToggleOpen,
}: {
  area: Area
  value: Level | undefined
  roleDefault: Level
  baseLevel: Level | null
  seat: SeatType
  profileRole: OrganizationRole
  disabled: boolean
  onChange: (level: Level | undefined) => void
  /** Nested rows from `renderChildren` (Records → per-def, Datasets / Knowledge
   *  base / Dashboards → per-instance). `undefined` = no children for this area. */
  childRows?: ReactNode
  isOpen?: boolean
  onToggleOpen?: () => void
}) {
  const meta = PERMISSION_AREAS[area]
  const lockReason = lockReasonFor(area, seat)
  const isSeatLocked = lockReason === WORKER_LOCK_REASON

  // What the area falls through to when nothing is stored. A field-seat-locked row
  // shows the level that actually applies (None, from `SEAT_CEILINGS`) — a base
  // authored above it would never reach a holder. Otherwise an unset base means
  // `baseLevel` and then the member default.
  const inherited = isSeatLocked ? Level.None : (baseLevel ?? roleDefault)

  const unsetHint = isSeatLocked
    ? 'Seat ceiling'
    : baseLevel !== null
      ? 'Not set · profile default'
      : UNSET_HINT_BY_ROLE[profileRole]

  return (
    <TreeRow
      rowClassName='bg-primary-50 hover:bg-primary-100'
      title={meta.label}
      description={meta.description}
      secondary={
        lockReason ? (
          <Tooltip content={lockReason}>
            <Lock className='size-3 text-muted-foreground' />
          </Tooltip>
        ) : undefined
      }
      expandable={childRows !== undefined}
      isOpen={childRows !== undefined ? isOpen : undefined}
      onToggleOpen={childRows !== undefined ? onToggleOpen : undefined}
      trailing={
        <LevelControl
          area={meta}
          value={value}
          inherited={inherited}
          unsetHint={unsetHint}
          resetTooltip='Clear (back to the default)'
          onChange={onChange}
          disabled={disabled || lockReason !== null}
        />
      }>
      {childRows}
    </TreeRow>
  )
}
