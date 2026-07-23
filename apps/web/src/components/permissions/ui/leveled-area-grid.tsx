// apps/web/src/components/permissions/ui/leveled-area-grid.tsx
'use client'

import { AREA_ORDER, type Area, type Level, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { useMemo } from 'react'
import { LevelControl } from './level-control'

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
}

/** Grantable (non-`adminOnly`) areas, grouped by registry `group` in area order. */
const AREA_GROUPS: Array<{ group: string; areas: Area[] }> = (() => {
  const order: string[] = []
  const byGroup = new Map<string, Area[]>()
  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (meta.adminOnly) continue
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
 * with its {@link LevelControl}, grouped by registry group (Tickets, Records,
 * Automation, …). `adminOnly` areas are never shown — they're not grantable below
 * ADMIN. In `override` mode each area inherits from the member baseline (and is
 * raise-only, enforced server-side); in `baseline` mode it inherits from the role
 * default. Every rung is selectable in both modes — an override that doesn't lift
 * the baseline is composed away and flagged as "ignored" on the grantee.
 */
export function LeveledAreaGrid({
  values,
  roleDefaults,
  baseline,
  mode,
  onChange,
  disabled = false,
}: LeveledAreaGridProps) {
  const inheritedFor = useMemo(
    () => (area: Area) =>
      mode === 'override' ? (baseline?.[area] ?? roleDefaults[area]) : roleDefaults[area],
    [mode, baseline, roleDefaults]
  )

  return (
    <div className='flex flex-col gap-4'>
      {AREA_GROUPS.map(({ group, areas }) => (
        <div key={group} className='flex flex-col gap-0.5'>
          <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
          {areas.map((area) => {
            const meta = PERMISSION_AREAS[area]
            const inherited = inheritedFor(area)
            return (
              <TreeRow
                rowClassName='bg-primary-50 hover:bg-primary-100'
                key={area}
                title={meta.label}
                description={meta.description}
                trailing={
                  <LevelControl
                    area={meta}
                    value={values[area]}
                    inherited={inherited}
                    ignored={
                      mode === 'override' &&
                      values[area] !== undefined &&
                      (values[area] as Level) <= inherited
                    }
                    onChange={(level) => onChange(area, level)}
                    disabled={disabled}
                  />
                }
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
