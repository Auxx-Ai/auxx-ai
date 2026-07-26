// apps/web/src/components/permissions/ui/profile-area-grid.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { type Area, Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { Lock, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { LevelControl } from './level-control'
import {
  PROFILE_AREA_GROUPS,
  ROLE_GATED_REASON,
  WORKER_LOCK_REASON,
  WORKER_SEAT_AREAS,
} from './profile-copy'

interface ProfileAreaGridProps {
  /**
   * The profile's per-area BASE — what holders start with. Sparse: an absent area
   * falls through to `baseLevel` and then `ROLE_DEFAULTS`.
   */
  values: Partial<Record<Area, Level>>
  /** The USER role's per-area defaults — the last fall-through of the base map. */
  roleDefaults: Record<Area, Level>
  /** The profile's blanket rung for unset areas, or `null`. */
  baseLevel?: Level | null
  /** Drives the §0.19 field-seat lock — a worker profile cannot author non-worker areas. */
  seat: SeatType
  onChange: (area: Area, level: Level | undefined) => void
  disabled?: boolean
}

/** Why one row is not editable, or `null` when it is. */
function lockReasonFor(area: Area, seat: SeatType): string | null {
  if (PERMISSION_AREAS[area].roleGated) return ROLE_GATED_REASON
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
 *    editor refuses to author a contradiction with `SEAT_CEILINGS`), and a
 *    `roleGated` area's routers are still a binary admin gate (§5.3). Locked rows
 *    render disabled at the level that actually applies, with the reason on hover.
 */
export function ProfileAreaGrid({
  values,
  roleDefaults,
  baseLevel = null,
  seat,
  onChange,
  disabled = false,
}: ProfileAreaGridProps) {
  const [search, setSearch] = useState('')
  const [configuredOnly, setConfiguredOnly] = useState(false)
  const query = search.trim().toLowerCase()

  const groups = useMemo(() => {
    const out: Array<{ group: string; areas: Area[] }> = []
    for (const { group, areas } of PROFILE_AREA_GROUPS) {
      const rows = areas.filter((area) => {
        if (configuredOnly && values[area] === undefined) return false
        if (!query) return true
        const meta = PERMISSION_AREAS[area]
        return (
          meta.label.toLowerCase().includes(query) || meta.description.toLowerCase().includes(query)
        )
      })
      if (rows.length > 0) out.push({ group, areas: rows })
    }
    return out
  }, [query, configuredOnly, values])

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
          {groups.map(({ group, areas }) => (
            <div key={group} className='flex flex-col gap-0.5'>
              <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
              {areas.map((area) => (
                <ProfileAreaRow
                  key={area}
                  area={area}
                  value={values[area]}
                  roleDefault={roleDefaults[area]}
                  baseLevel={baseLevel}
                  seat={seat}
                  disabled={disabled}
                  onChange={(level) => onChange(area, level)}
                />
              ))}
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
  disabled,
  onChange,
}: {
  area: Area
  value: Level | undefined
  roleDefault: Level
  baseLevel: Level | null
  seat: SeatType
  disabled: boolean
  onChange: (level: Level | undefined) => void
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
      : 'Not set · member default'

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
      trailing={
        <LevelControl
          area={meta}
          value={value}
          inherited={inherited}
          unsetHint={unsetHint}
          resetTooltip='Clear — back to the default'
          onChange={onChange}
          disabled={disabled || lockReason !== null}
        />
      }
    />
  )
}
