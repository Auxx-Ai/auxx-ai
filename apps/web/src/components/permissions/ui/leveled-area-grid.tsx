// apps/web/src/components/permissions/ui/leveled-area-grid.tsx
'use client'

import { AREA_ORDER, type Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { LevelControl } from './level-control'

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
   * `override` — a group/user grant that can only raise above the baseline;
   * `agent` — an AGENT grantee's own profile: SET-semantics over an all-Full
   * base (capability layer v2 §0.2/§0.3), so every area falls through to
   * **Full** rather than to any baseline, nothing is ever "ignored", and `None`
   * is the meaningful rung (the only way to lock an area down for an agent).
   */
  mode: 'baseline' | 'override' | 'agent'
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
}

/** The §5.3 wording for an area whose routers are still a binary admin gate. */
const ROLE_GATED_NOTE = 'Still role-gated. Admins reach this regardless.'

/**
 * Grantable areas, grouped by registry `group` in area order. Excludes
 * `adminOnly` (never grantable below ADMIN) and `workerOnly` (enforced only on a
 * worker seat, so a level control here would do nothing).
 *
 * `roleGated` areas ARE included — they are grantable in the model (doc 19
 * §0.25) — but render locked, because their routers are still binary
 * `adminProcedure` checks (§5.3).
 */
const AREA_GROUPS: Array<{ group: string; areas: Area[] }> = (() => {
  const order: string[] = []
  const byGroup = new Map<string, Area[]>()
  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (meta.adminOnly || meta.workerOnly) continue
    if (!byGroup.has(meta.group)) {
      byGroup.set(meta.group, [])
      order.push(meta.group)
    }
    byGroup.get(meta.group)?.push(area)
  }
  return order.map((group) => ({ group, areas: byGroup.get(group) ?? [] }))
})()

/**
 * The shared leveled surface: every grantable area rendered as a labelled row
 * with its {@link LevelControl}, grouped by registry group (Records,
 * Automation, …). `adminOnly` areas are never shown — they're not grantable below
 * ADMIN. In `override` mode each area inherits from the member baseline (and is
 * raise-only, enforced server-side); in `baseline` mode it inherits from the role
 * default; in `agent` mode there is no inheritance at all — an unset area IS Full
 * (§0.3), so it renders as a "Default" fall-through to Full. Every rung is
 * selectable in every mode — an override that doesn't lift the baseline is
 * composed away and flagged as "ignored" on the grantee (member surfaces only;
 * for an agent a `None` genuinely lowers, so nothing is ever ignored).
 *
 * An area may also nest child rows via `renderChildren` (the member baseline
 * supplies per-def workspace baselines under Records). Children are collapsed by
 * default and participate in the search: a def name keeps its parent row visible
 * and expands it.
 */
export function LeveledAreaGrid({
  values,
  roleDefaults,
  baseline,
  mode,
  onChange,
  disabled = false,
  renderChildren,
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
    for (const { group, areas } of AREA_GROUPS) {
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
          label={mode === 'agent' ? 'Restrictions only' : 'Overrides only'}
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
                // Agent profiles compose by SET over an all-Full base — an unset
                // area IS Full, there is nothing to inherit from (§0.2/§0.3).
                const inherited =
                  mode === 'agent'
                    ? Level.Full
                    : mode === 'override'
                      ? (baseline?.[area] ?? roleDefaults[area])
                      : roleDefaults[area]
                const isOpen = openAreas[area] ?? autoOpen
                return (
                  <TreeRow
                    rowClassName='bg-primary-50 hover:bg-primary-100'
                    key={area}
                    title={meta.label}
                    description={
                      meta.roleGated ? `${meta.description} ${ROLE_GATED_NOTE}` : meta.description
                    }
                    expandable={children !== undefined}
                    isOpen={children !== undefined ? isOpen : undefined}
                    onToggleOpen={
                      children !== undefined
                        ? () => setOpenAreas((prev) => ({ ...prev, [area]: !isOpen }))
                        : undefined
                    }
                    trailing={
                      <LevelControl
                        area={meta}
                        value={value}
                        inherited={inherited}
                        ignored={mode === 'override' && value !== undefined && value <= inherited}
                        unsetHint={mode === 'agent' ? 'Default' : undefined}
                        resetTooltip={
                          mode === 'agent' ? 'Clear (back to full access)' : 'Reset to inherited'
                        }
                        onChange={(level) => onChange(area, level)}
                        disabled={disabled || meta.roleGated === true}
                      />
                    }>
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
