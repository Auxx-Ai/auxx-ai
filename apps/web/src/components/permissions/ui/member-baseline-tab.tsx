// apps/web/src/components/permissions/ui/member-baseline-tab.tsx
'use client'

import { Area, type Level } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback } from 'react'
import { useDefBaselines } from '../hooks/use-def-baselines'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from '../hooks/use-permission-grants'
import { DefBaselineRows } from './def-baseline-rows'
import { type AreaChildFilter, type AreaChildren, LeveledAreaGrid } from './leveled-area-grid'

/**
 * The org-wide member baseline (`role:org_member`) — the one downward lever
 * (v1.5 §L4). Every full member inherits these levels; lowering an area (e.g.
 * Records → Read) means members can't edit or delete there. Areas left at their
 * role default aren't stored, so re-tuning a default later still reaches them.
 *
 * TODO(plan-19-step-7): the area levels below are stored on the org's **`member`
 * permission profile**, which doc 19 §0.8 defines as the baseline. The
 * `role:org_member` address this component sends is redirected in both directions
 * by `apps/web/src/server/api/routers/permissions-member-baseline.ts`; step 7
 * replaces this tab with the Member-profile editor and deletes that shim. The
 * nested per-def rows are unaffected — those are `ResourceAccess` workspace
 * baselines, a separate and still-live `role:org_member` mechanism.
 *
 * The **Records** area expands into one row per CRM record type carrying that
 * def's workspace baseline (Layer 3) — the value the def's own Permissions tab
 * writes as "Default for all members". A def with no stored baseline falls
 * through to the Records level shown on the parent row; an explicit level
 * replaces it for that def (most-specific-wins), and No Access restricts it.
 */
export function MemberBaselineTab({ disabled = false }: { disabled?: boolean }) {
  const { isLoading, roleDefaults, baseline, save, remove } = usePermissionGrants()
  const { isLoading: defsLoading, rows: defRows, setBaseline: setDefBaseline } = useDefBaselines()

  const handleChange = (area: Area, level: Level | undefined) => {
    const next = { ...baseline }
    // Storing the role default adds no information — keep the map sparse so a
    // future default change still propagates (v1.5 §7.1d).
    if (level === undefined || level === roleDefaults?.[area]) delete next[area]
    else next[area] = level

    if (Object.keys(next).length === 0) remove('role', MEMBER_BASELINE_GRANTEE_ID)
    else save('role', MEMBER_BASELINE_GRANTEE_ID, next)
  }

  /**
   * Per-def workspace baselines nested under Records. "Overrides only" here means
   * "defs with a stored `role:org_member` row"; the match count lets the grid keep
   * (and expand) the Records row when a def name — not the area label — matched.
   */
  const renderChildren = useCallback(
    (area: Area, filter: AreaChildFilter): AreaChildren | undefined => {
      if (area !== Area.records) return undefined
      if (defsLoading)
        return {
          matchCount: 0,
          rows: <DefBaselineRows rows={[]} isLoading onChange={setDefBaseline} />,
        }

      const matched = defRows.filter((row) => {
        if (filter.overridesOnly && row.baselineLevel === undefined) return false
        if (!filter.query) return true
        const { plural, label } = row.resource
        return (
          plural.toLowerCase().includes(filter.query) || label.toLowerCase().includes(filter.query)
        )
      })

      return {
        matchCount: matched.length,
        rows: <DefBaselineRows rows={matched} disabled={disabled} onChange={setDefBaseline} />,
      }
    },
    [defsLoading, defRows, disabled, setDefBaseline]
  )

  if (isLoading || !roleDefaults) {
    return (
      <div className='space-y-2 p-3 sm:p-6'>
        <Skeleton className='h-24 w-full rounded-lg' />
        <Skeleton className='h-24 w-full rounded-lg' />
      </div>
    )
  }

  return (
    <div className='p-3 sm:p-6'>
      <p className='mb-4 max-w-2xl text-sm text-muted-foreground'>
        The access every full member starts with. Lower an area to restrict all members, or leave it
        at its default. Groups and individual members can be granted more below. Expand Records to
        set a different default for an individual record type.
      </p>
      <LeveledAreaGrid
        mode='baseline'
        values={baseline}
        roleDefaults={roleDefaults}
        onChange={handleChange}
        disabled={disabled}
        renderChildren={renderChildren}
      />
    </div>
  )
}
