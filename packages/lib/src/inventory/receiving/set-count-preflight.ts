// packages/lib/src/inventory/receiving/set-count-preflight.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { findSystemRecordIdsByValue, systemFields } from '../../resources/system-records'
import {
  readEarliestMovementAt,
  readPartBuiltTotal,
  readPartNetThrough,
} from '../costing/dated-reads'
import { readPartInitials } from '../movements/initial-queries'
import { guard } from './guard'

/** What the Set count dialog needs before it writes (111 Q25): the anchor state and the backflush signal. */
export interface SetCountPreflight {
  partId: string
  hasInitial: boolean
  /** Net quantity of every movement to now. */
  netToday: number
  earliest: Date | null
  hasBom: boolean
  /** BOM parts only: the negative replay a backflush would cover, `max(0, −netToday)`. */
  unbuiltSales: number
  /** Units produced by builds, all time, net of undone builds. */
  built: number
}

export async function readSetCountPreflight(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Result<SetCountPreflight[], Error>> {
  return guard(
    async () => {
      const unique = [...new Set(partIds.filter(Boolean))]
      if (unique.length === 0) return []
      const [nets, earliests, initials, boms, builts] = await Promise.all([
        readPartNetThrough(organizationId, unique, new Date()),
        readEarliestMovementAt(organizationId, unique),
        readPartInitials(db, organizationId, unique),
        readPartsWithBom(db, organizationId, unique),
        readPartBuiltTotal(organizationId, unique),
      ])
      return unique.map((partId) => {
        const netToday = nets.get(partId) ?? 0
        const hasBom = boms.has(partId)
        return {
          partId,
          hasInitial: initials.has(partId),
          netToday,
          earliest: earliests.get(partId) ?? null,
          hasBom,
          unbuiltSales: hasBom ? Math.max(0, -netToday) : 0,
          built: builts.get(partId) ?? 0,
        }
      })
    },
    'Failed to read the set count preflight',
    { organizationId, partIds: partIds.length }
  )
}

/** Every named part that is the parent of at least one live `subpart` line. */
async function readPartsWithBom(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Set<string>> {
  const ctx = await systemFields(db, organizationId, 'subpart', ['subpart_parent_part'] as const, {
    required: ['subpart_parent_part'],
  })
  if (!ctx) return new Set()
  const byParent = await findSystemRecordIdsByValue(db, organizationId, ctx, {
    attribute: 'subpart_parent_part',
    related: partIds,
  })
  return new Set(byParent.keys())
}
