// apps/web/src/components/permissions/ui/member-baseline-tab.tsx
'use client'

import type { Area, Level } from '@auxx/lib/permissions/client'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { MEMBER_BASELINE_GRANTEE_ID, usePermissionGrants } from '../hooks/use-permission-grants'
import { LeveledAreaGrid } from './leveled-area-grid'

/**
 * The org-wide member baseline (`role:org_member`) — the one downward lever
 * (v1.5 §L4). Every full member inherits these levels; lowering an area (e.g.
 * Records → Read) means members can't edit or delete there. Areas left at their
 * role default aren't stored, so re-tuning a default later still reaches them.
 */
export function MemberBaselineTab({ disabled = false }: { disabled?: boolean }) {
  const { isLoading, roleDefaults, baseline, save, remove } = usePermissionGrants()

  const handleChange = (area: Area, level: Level | undefined) => {
    const next = { ...baseline }
    // Storing the role default adds no information — keep the map sparse so a
    // future default change still propagates (v1.5 §7.1d).
    if (level === undefined || level === roleDefaults?.[area]) delete next[area]
    else next[area] = level

    if (Object.keys(next).length === 0) remove('role', MEMBER_BASELINE_GRANTEE_ID)
    else save('role', MEMBER_BASELINE_GRANTEE_ID, next)
  }

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
        at its default. Groups and individual members can be granted more below.
      </p>
      <LeveledAreaGrid
        mode='baseline'
        values={baseline}
        roleDefaults={roleDefaults}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}
