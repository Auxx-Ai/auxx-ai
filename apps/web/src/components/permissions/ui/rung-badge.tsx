// apps/web/src/components/permissions/ui/rung-badge.tsx
'use client'

import type { Level } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { effectiveLevelLabel, RUNG_BADGE_VARIANT } from './level-labels'

/**
 * A rung as it reads at the END of an area row — the resolved level a collapsed
 * header states when its control lives one row down (plan 26 §2.1b).
 *
 * It was `<span className='text-xs text-muted-foreground'>` on both grids, which
 * put the one thing a reader scans a collapsed profile FOR in the same grey as
 * the fall-through hints beside it. A badge is scannable at a glance and, colour
 * coded off {@link RUNG_BADGE_VARIANT}, distinguishes the rungs without being
 * read — which is the whole point of a label that exists so the tree does not
 * have to be expanded.
 *
 * Copy is unchanged: {@link effectiveLevelLabel}, so the bottom rung stays
 * *No access* rather than a bare "None" that reads as a missing value.
 *
 * `mr-2` because `TreeRow`'s actions cluster has no padding of its own: the rows
 * that end in a picker get their inset from the control's own box, and a bare
 * badge would otherwise sit hard against the row's right edge.
 */
export function RungBadge({ level }: { level: Level }) {
  return (
    <Badge variant={RUNG_BADGE_VARIANT[level]} size='xs' className='mr-2 whitespace-nowrap'>
      {effectiveLevelLabel(level)}
    </Badge>
  )
}
