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
   *
   * Optional because an agent policy has no role fall-through at all: its
   * `areas.default` is mandatory, so a row always falls through to `baseLevel`
   * and never reaches this map. When absent every area's final fall-through is
   * `Level.None` — fail closed, the same direction `normalizeAgentPolicy` takes.
   */
  roleDefaults?: Record<Area, Level>
  /** The profile's blanket rung for unset areas, or `null`. */
  baseLevel?: Level | null
  /**
   * Drives the §0.19 field-seat lock — a worker profile cannot author non-worker
   * areas. Optional: an agent holds no seat, so with no `seat` nothing is ever
   * locked and `lockReasonFor` returns `null` for every area.
   */
  seat?: SeatType
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
  /**
   * Which areas the grid offers, grouped — `areaGroups()` from `profile-copy.ts`.
   * Defaults to {@link PROFILE_AREA_GROUPS} (the human selection, no `adminOnly`
   * and no `workerOnly`); the agent policy passes `AGENT_POLICY_AREA_GROUPS`,
   * which keeps the `adminOnly` areas.
   */
  areaGroups?: Array<{ group: string; areas: Area[] }>
  /**
   * Override the `Not set · …` hint on a row with no stored level of its own —
   * the agent policy names the rung its mandatory default resolves to on that
   * area (`Default · Read`) instead of the human `Not set · profile default` /
   * {@link UNSET_HINT_BY_ROLE} derivation, which is what this defaults to.
   *
   * **Precedence: the seat lock wins.** A field-seat-locked row keeps its
   * `Seat ceiling` hint whatever this returns — the ceiling is a hard fact about
   * what reaches a holder, not a statement about where an unset row falls
   * through, and no caller may talk over it. (Moot for the agent caller, which
   * passes no `seat` and therefore locks nothing.)
   */
  unsetHintFor?: (area: Area) => string
  /**
   * Fired when the viewer expands or collapses one area's child block — the
   * grid's internal `openAreas` state, reported outward.
   *
   * Exists for ONE reason: a caller whose child rows are fetched lazily per
   * expanded area (the agent policy's dataset / KB / dashboard / workflow
   * lists) cannot see this state otherwise, because the grid owns it and calls
   * `renderChildren` for EVERY area — collapsed ones included — to compute
   * `matchCount`. Without this hook the caller's only options are to fetch
   * every list on mount (four queries an admin who never expands a row does
   * not pay for today) or to render children it has no data for.
   *
   * **The tradeoff it accepts:** a lazy caller's `matchCount` is 0 for an area
   * whose list has never been fetched, so a search can only match child rows
   * of already-expanded areas. That is exactly today's behavior on the agent
   * policy surface (its resource lists were behind a per-row expand toggle and
   * its Resources section had no search at all), and eager callers
   * (`use-instance-baseline-rows`, `use-instance-grantee-rows`, both passing
   * `ALWAYS_OPEN`) are unaffected — their lists are loaded before the first
   * `renderChildren` call, so every child is searchable.
   *
   * Not fired for search-driven auto-expansion: a child can only match once
   * its data is loaded, so auto-open never precedes a fetch.
   */
  onAreaOpenChange?: (area: Area, isOpen: boolean) => void
}

/** Why one row is not editable, or `null` when it is (incl. every row of a seatless grid). */
function lockReasonFor(area: Area, seat: SeatType | undefined): string | null {
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
  areaGroups = PROFILE_AREA_GROUPS,
  unsetHintFor,
  onAreaOpenChange,
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
    for (const { group, areas } of areaGroups) {
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
  }, [query, configuredOnly, values, renderChildren, areaGroups])

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
                    // No `roleDefaults` = no role fall-through to reach (agent
                    // policy): resolve it to None rather than letting `undefined`
                    // leak into the row's `inherited` comparison.
                    roleDefault={roleDefaults?.[area] ?? Level.None}
                    baseLevel={baseLevel}
                    seat={seat}
                    profileRole={profileRole}
                    unsetHint={unsetHintFor?.(area)}
                    disabled={disabled}
                    onChange={(level) => onChange(area, level)}
                    childRows={children?.rows}
                    isOpen={isOpen}
                    onToggleOpen={
                      children !== undefined
                        ? () => {
                            setOpenAreas((prev) => ({ ...prev, [area]: !isOpen }))
                            onAreaOpenChange?.(area, !isOpen)
                          }
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
  unsetHint: unsetHintOverride,
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
  seat: SeatType | undefined
  profileRole: OrganizationRole
  /** Caller-supplied "Not set" hint — the seat lock still outranks it. */
  unsetHint?: string
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

  // The seat ceiling outranks any caller override: it states what actually
  // reaches a holder, not where an unset row falls through.
  const unsetHint = isSeatLocked
    ? 'Seat ceiling'
    : (unsetHintOverride ??
      (baseLevel !== null ? 'Not set · profile default' : UNSET_HINT_BY_ROLE[profileRole]))

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
