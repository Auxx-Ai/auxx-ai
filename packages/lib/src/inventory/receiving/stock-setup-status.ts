// packages/lib/src/inventory/receiving/stock-setup-status.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import { readKindConflictEdges, readKindConflicts } from '../builds/kind-conflicts'
import { isServicePartKind } from '../costing/client'
import { readPartNetThrough } from '../costing/dated-reads'
import { neededPartIds } from '../costing/standard-cost-worklist'
import { guard } from './guard'
import { readPartsWithInitialMovement, readPartsWithMovements } from './movement-coverage'

const PART_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_kind',
  'part_kind_confirmed',
  'part_standard_cost',
  'part_product',
] as const)

/** Where the four Stock setup steps stand (plans/mrp/17 §5, 22 F1). Cheap: no backflush replay. */
export interface StockSetupStatus {
  /** Parts whose kind contradicts their BOM edges and nobody confirmed it (17 D3). */
  kindConflictCount: number
  /** Parts on the default kind that the suggestion reads as a finished good. */
  unconfirmedKindCount: number
  /** Made parts whose net stock is below zero today: sales no build covers. */
  unbuiltPartCount: number
  /** Bought parts (no BOM) a build will consume or that moved, with no standard (22 §3.2). */
  neededUncostedCount: number
  costsSkipped: boolean
  buildsSkipped: boolean
  countingDone: boolean
  /** Stocked parts with any movement: the set step 3's "N of M counted" is out of. */
  movedPartCount: number
  /** Of those, the parts with a first count (an `initial`). */
  countedPartCount: number
  /** Stocked parts that moved and have no standard, so their legs stay `pending`. */
  uncostedPartCount: number
  /** Any non-service part with a movement; without one the org has no stock to set up. */
  hasStockedMovements: boolean
  steps: { kinds: boolean; costs: boolean; builds: boolean; count: boolean }
}

/** Unset, or the defaulted `component` (mirrors the web's `isPartKindUnclassified`). */
function isUnclassified(kind: string | null): boolean {
  return kind == null || kind === '' || kind === 'component'
}

/**
 * The status loader behind the `stockSetupStatus` org cache key; read the cache, not this.
 * No backflush replay; the only movement-sized read is the net of the made parts that moved.
 */
export async function readStockSetupStatus(
  db: Database,
  organizationId: string
): Promise<Result<StockSetupStatus, Error>> {
  return guard(
    async () => {
      const [parts, moved, initials, edges, subpartEdges, conflictsResult, settings] =
        await Promise.all([
          readStockedParts(db, organizationId),
          readPartsWithMovements(db, organizationId),
          readPartsWithInitialMovement(db, organizationId),
          readKindConflictEdges(organizationId),
          getOrgCache().get(organizationId, 'subpartEdges'),
          readKindConflicts(db, organizationId),
          getOrgCache().get(organizationId, 'orgSettings'),
        ])
      if (conflictsResult.isErr()) throw conflictsResult.error
      const conflictIds = new Set(conflictsResult.value.map((c) => c.partId))

      const unconfirmedKindCount = parts.filter(
        (p) =>
          !conflictIds.has(p.partId) &&
          p.hasProduct &&
          !edges.children.has(p.partId) &&
          !p.kindConfirmed &&
          isUnclassified(p.kind)
      ).length

      const movedParts = parts.filter((p) => moved.has(p.partId))
      const madeMoved = movedParts.filter((p) => edges.parents.has(p.partId)).map((p) => p.partId)
      const nets = await readPartNetThrough(organizationId, madeMoved, new Date())
      const unbuiltPartCount = madeMoved.filter((id) => (nets.get(id) ?? 0) < 0).length

      const needed = neededPartIds(subpartEdges ?? [], moved)
      const neededUncostedCount = parts.filter(
        (p) => needed.has(p.partId) && !edges.parents.has(p.partId) && p.standardCost == null
      ).length
      const costsSkipped = settings['inventory.stockSetup.costsSkipped'] === true
      const buildsSkipped = settings['inventory.stockSetup.buildsSkipped'] === true
      const countingDone = settings['inventory.stockSetup.countingDone'] === true
      const uncostedPartCount = movedParts.filter((p) => p.standardCost == null).length
      const countedPartCount = movedParts.filter((p) => initials.has(p.partId)).length

      const kindConflictCount = conflictIds.size
      return {
        kindConflictCount,
        unconfirmedKindCount,
        unbuiltPartCount,
        neededUncostedCount,
        costsSkipped,
        buildsSkipped,
        countingDone,
        movedPartCount: movedParts.length,
        countedPartCount,
        uncostedPartCount,
        hasStockedMovements: movedParts.length > 0,
        steps: {
          kinds: kindConflictCount === 0 && unconfirmedKindCount === 0,
          costs: neededUncostedCount === 0 || costsSkipped,
          builds: unbuiltPartCount === 0 || buildsSkipped,
          count: countingDone,
        },
      }
    },
    'Failed to read the stock setup status',
    { organizationId }
  )
}

/** Every live, non-service part with the three facts the status counts from. */
async function readStockedParts(
  db: Database,
  organizationId: string
): Promise<
  {
    partId: string
    kind: string | null
    kindConfirmed: boolean
    standardCost: number | null
    hasProduct: boolean
  }[]
> {
  const ctx = await systemFields(db, organizationId, 'part', PART_PICK)
  if (!ctx) return []
  const rows = await readSystemRecords(db, organizationId, ctx)
  return rows
    .filter((row) => !isServicePartKind(row.option('part_kind')))
    .map((row) => ({
      partId: row.id,
      kind: row.option('part_kind'),
      kindConfirmed: row.boolean('part_kind_confirmed') === true,
      standardCost: row.number('part_standard_cost'),
      hasProduct: row.related('part_product') != null,
    }))
}
