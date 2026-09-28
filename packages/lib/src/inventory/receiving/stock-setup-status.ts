// packages/lib/src/inventory/receiving/stock-setup-status.ts

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { readKindConflicts } from '../builds/kind-conflicts'
import { readPartNetThrough } from '../costing/dated-reads'
import { guard } from './guard'
import { listOpeningStockCandidates } from './opening-stock-queries'

/** Where the three Stock setup steps stand (plans/mrp/17 §5). Cheap: no backflush replay. */
export interface StockSetupStatus {
  /** Parts whose kind contradicts their BOM edges and nobody confirmed it (17 D3). */
  kindConflictCount: number
  /** Parts on the default kind that the suggestion reads as a finished good. */
  unconfirmedKindCount: number
  /** Made parts whose net stock is below zero today: sales no build covers. */
  unbuiltPartCount: number
  buildsSkipped: boolean
  countingDone: boolean
  /** Stocked parts that moved and have no standard, so their legs stay `pending`. */
  uncostedPartCount: number
  /** Any non-service part with a movement; without one the org has no stock to set up. */
  hasStockedMovements: boolean
  steps: { kinds: boolean; builds: boolean; count: boolean }
}

/** Unset, or the defaulted `component` (mirrors the web's `isPartKindUnclassified`). */
function isUnclassified(kind: string | null): boolean {
  return kind == null || kind === '' || kind === 'component'
}

export async function readStockSetupStatus(
  db: Database,
  organizationId: string
): Promise<Result<StockSetupStatus, Error>> {
  return guard(
    async () => {
      const [candidatesResult, conflictsResult, settings, bomParents] = await Promise.all([
        listOpeningStockCandidates(db, organizationId),
        readKindConflicts(db, organizationId),
        getOrgCache().get(organizationId, 'orgSettings'),
        readBomParentIds(db, organizationId),
      ])
      if (candidatesResult.isErr()) throw candidatesResult.error
      if (conflictsResult.isErr()) throw conflictsResult.error
      const candidates = candidatesResult.value
      const conflictIds = new Set(conflictsResult.value.map((c) => c.partId))

      const unconfirmedKindCount = candidates.filter(
        (c) =>
          !conflictIds.has(c.partId) &&
          c.hasProduct &&
          !c.isSubpartOfAssembly &&
          isUnclassified(c.partKind)
      ).length

      const madeMoved = candidates
        .filter((c) => c.hasMovements && bomParents.has(c.partId))
        .map((c) => c.partId)
      const nets = await readPartNetThrough(organizationId, madeMoved, new Date())
      const unbuiltPartCount = madeMoved.filter((id) => (nets.get(id) ?? 0) < 0).length

      const buildsSkipped = settings['inventory.stockSetup.buildsSkipped'] === true
      const countingDone = settings['inventory.stockSetup.countingDone'] === true
      const uncostedPartCount = candidates.filter(
        (c) => c.hasMovements && c.standardCost == null
      ).length

      const kindConflictCount = conflictIds.size
      return {
        kindConflictCount,
        unconfirmedKindCount,
        unbuiltPartCount,
        buildsSkipped,
        countingDone,
        uncostedPartCount,
        hasStockedMovements: candidates.some((c) => c.hasMovements),
        steps: {
          kinds: kindConflictCount === 0 && unconfirmedKindCount === 0,
          builds: unbuiltPartCount === 0 || buildsSkipped,
          count: countingDone && uncostedPartCount === 0,
        },
      }
    },
    'Failed to read the stock setup status',
    { organizationId }
  )
}

/** Every part that heads a live BOM line, org-wide. */
async function readBomParentIds(db: Database, organizationId: string): Promise<Set<string>> {
  const parents = new Set<string>()
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['subpart_parent_part'] as const)
  const parentField = fields.subpart_parent_part
  if (!parentField) return parents

  const rows = await db
    .selectDistinct({ partId: schema.FieldValue.relatedEntityId })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, parentField.id),
        isNotNull(schema.FieldValue.relatedEntityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  for (const row of rows) if (row.partId) parents.add(row.partId)
  return parents
}
