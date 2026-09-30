// packages/lib/src/data-migrations/migrations/203-stock-movement-consumption-class.ts
// Stamps `StockMovement.consumptionClass` on every row written before the column existed.
// See plans/mrp/21-after-stock-movement-table.md §1.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { chunkArray } from '../../import/utils/chunk-array'
import type { ConsumptionClass } from '../../inventory/movements/classify'
import { readConsumptionClasses } from '../../inventory/movements/reads'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:203')

const UPDATE_CHUNK = 5000

export interface Migration203Result extends PerOrgMigrationResult {
  movementsClassified: number
}

const NOTHING: Migration203Result = {
  entityDefsCreated: 0,
  fieldsCreated: 0,
  relationshipsLinked: 0,
  alreadyUpToDate: true,
  movementsClassified: 0,
}

/**
 * Migration 203: classify every unstamped movement with the writer's own rules (a reversal takes
 * its original's class), then one UPDATE per class and chunk. Idempotent: only null rows are read
 * and written, so a rerun finds nothing.
 */
export const migration203StockMovementConsumptionClass: PerOrgMigration = {
  id: '203-stock-movement-consumption-class',
  description:
    'Backfills StockMovement.consumptionClass on rows written before the column, using the ' +
    'same classification the movement writer stamps (plans/mrp/21 §1).',

  async up(db: Database, organizationId: string): Promise<Migration203Result> {
    const t = schema.StockMovement
    const unset = await db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.organizationId, organizationId), isNull(t.consumptionClass)))
    if (unset.length === 0) return NOTHING

    const classes = await readConsumptionClasses(
      db,
      organizationId,
      unset.map((row) => row.id)
    )
    const byClass = new Map<ConsumptionClass, string[]>()
    for (const [id, cls] of classes) {
      const ids = byClass.get(cls)
      if (ids) ids.push(id)
      else byClass.set(cls, [id])
    }

    let classified = 0
    for (const [cls, ids] of byClass) {
      for (const chunk of chunkArray(ids, UPDATE_CHUNK)) {
        const updated = await db
          .update(t)
          .set({ consumptionClass: cls })
          .where(
            and(
              eq(t.organizationId, organizationId),
              inArray(t.id, chunk),
              isNull(t.consumptionClass)
            )
          )
        classified += updated.rowCount ?? 0
      }
    }

    logger.info('Migration 203 applied', { organizationId, movementsClassified: classified })
    return { ...NOTHING, alreadyUpToDate: false, movementsClassified: classified }
  },
}
