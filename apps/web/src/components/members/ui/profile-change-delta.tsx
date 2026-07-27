// apps/web/src/components/members/ui/profile-change-delta.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import type { ProfileDelta } from '../hooks'
import { RUNG_LABELS, roleLabel } from '../hooks'

interface ProfileChangeDeltaProps {
  delta: ProfileDelta
  /** Only the display name is read — any profile row satisfies it. */
  from: { name: string } | undefined
  to: { name: string } | undefined
  /** Field seats carry an extra, non-negotiable cap the client cannot compute. */
  seatType: SeatType
  className?: string
}

/**
 * The **complete effective delta** of a reassignment (§7) — every area whose
 * effective rung moves once the member's team and personal grants are folded
 * into both sides.
 *
 * A profile supplies only a base, and composition is purely additive, so a row
 * moves down exactly when the incoming profile's base is lower and no grant
 * carries it back up. The shared raises are applied to both sides so the delta
 * reads as the member's resulting access, not as a diff of two bases.
 */
export function ProfileChangeDelta({
  delta,
  from,
  to,
  seatType,
  className,
}: ProfileChangeDeltaProps) {
  const grouped = useMemo(() => {
    const byGroup = new Map<string, ProfileDelta['areas']>()
    for (const row of delta.areas) {
      const list = byGroup.get(row.group) ?? []
      list.push(row)
      byGroup.set(row.group, list)
    }
    return [...byGroup.entries()]
  }, [delta.areas])

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border bg-muted/30 p-3', className)}>
      <p className='text-xs text-muted-foreground'>
        {from?.name ?? 'Current profile'} <ArrowRight className='inline size-3' />{' '}
        <span className='font-medium text-foreground'>{to?.name ?? 'New profile'}</span>. This is
        the member's effective access after the change, including their team and personal grants.
      </p>

      {delta.rankChange && (
        <div className='flex flex-col gap-1 rounded-lg border border-amber-400/40 bg-amber-400/5 px-2 py-1.5'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='text-sm font-medium'>Rank</span>
            <span className='inline-flex items-center gap-1.5'>
              <Badge variant='outline' size='xs' className='text-muted-foreground'>
                {roleLabel(delta.rankChange.from)}
              </Badge>
              <ArrowRight className='size-3 text-muted-foreground' />
              <Badge
                variant={delta.rankChange.direction === 'demotion' ? 'amber' : 'green'}
                size='xs'>
                {roleLabel(delta.rankChange.to)}
              </Badge>
            </span>
          </div>
          <p className='text-xs text-muted-foreground'>{delta.rankChange.message}</p>
        </div>
      )}

      {delta.isEmpty ? (
        <p className='text-sm text-muted-foreground'>
          No change to effective access. The two profiles resolve to the same levels for this
          member.
        </p>
      ) : delta.areas.length > 0 ? (
        <div className='flex flex-col gap-3'>
          {grouped.map(([group, rows]) => (
            <div key={group} className='flex flex-col gap-1'>
              <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
              {rows.map((row) => (
                <div
                  key={row.area}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-2 py-1'>
                  <span className='text-sm'>{row.label}</span>
                  <span className='inline-flex items-center gap-1.5'>
                    <Badge variant='outline' size='xs' className='text-muted-foreground'>
                      {RUNG_LABELS[row.before]}
                    </Badge>
                    <ArrowRight className='size-3 text-muted-foreground' />
                    <Badge variant={row.after < row.before ? 'amber' : 'green'} size='xs'>
                      {RUNG_LABELS[row.after]}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {seatType === 'worker' && (
        <p className='text-xs text-muted-foreground'>
          This member holds a field seat, which caps every area on top of the profile. The seat is
          unchanged by this assignment.
        </p>
      )}
    </div>
  )
}
