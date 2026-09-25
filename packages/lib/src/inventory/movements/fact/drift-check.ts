// packages/lib/src/inventory/movements/fact/drift-check.ts

import { type Database, schema } from '@auxx/database'
import { count, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { STOCK_MOVEMENT_FIELDS } from '../../../resources/registry/resources/stock-movement-fields'
import { pickSystemAttributes } from '../../../resources/registry/system-attributes'
import { systemFields, systemRecordScope, systemValueJoin } from '../../../resources/system-records'
import { guard } from '../guard'
import { type FactTotals, readFactTotalsByPart } from './reads'

const LEDGER_PICK = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_part',
  'stock_movement_quantity',
] as const)

/** A part whose mirror disagrees with the entity ledger on row count or quantity. */
export interface MovementFactDrift {
  partId: string
  ledgerCount: number
  factCount: number
  ledgerSum: number
  factSum: number
}

const EPSILON = 1e-9

/** Every part where the mirror's count or signed sum differs from the `stock_movement` ledger (the `mirror_drift` signal). */
export async function compareFactsToLedger(
  db: Database,
  organizationId: string
): Promise<Result<MovementFactDrift[], Error>> {
  return guard(
    async () => {
      const [ledger, facts] = await Promise.all([
        readLedgerTotals(db, organizationId),
        readFactTotalsByPart(db, organizationId),
      ])
      const drift: MovementFactDrift[] = []
      for (const partId of new Set([...ledger.keys(), ...facts.keys()])) {
        const l = ledger.get(partId) ?? { count: 0, sum: 0 }
        const f = facts.get(partId) ?? { count: 0, sum: 0 }
        if (l.count === f.count && Math.abs(l.sum - f.sum) < EPSILON) continue
        drift.push({
          partId,
          ledgerCount: l.count,
          factCount: f.count,
          ledgerSum: l.sum,
          factSum: f.sum,
        })
      }
      return drift.sort((a, b) => a.partId.localeCompare(b.partId))
    },
    'Failed to compare the movement mirror to the ledger',
    { organizationId }
  )
}

/**
 * Count and SUM of quantity per part over every `stock_movement`, archived included like `qoh.ts`.
 * Unlike `qoh.ts` it keeps an unexploded `adjust_subparts` row: the mirror stores every row, so like compares with like.
 */
async function readLedgerTotals(
  db: Database,
  organizationId: string
): Promise<Map<string, FactTotals>> {
  const ctx = await systemFields(db, organizationId, 'stock_movement', LEDGER_PICK, {
    required: ['stock_movement_part', 'stock_movement_quantity'],
  })
  if (!ctx) return new Map()
  const partValue = alias(schema.FieldValue, 'fv_part')
  const quantityValue = alias(schema.FieldValue, 'fv_quantity')
  // Aggregate: a grouped count and SUM per part has no system-records reader.
  const rows = await db
    .select({
      partId: partValue.relatedEntityId,
      n: count(),
      total: sum(quantityValue.valueNumber),
    })
    .from(schema.EntityInstance)
    .innerJoin(partValue, systemValueJoin(partValue, ctx.fields.stock_movement_part!.id))
    .leftJoin(quantityValue, systemValueJoin(quantityValue, ctx.fields.stock_movement_quantity!.id))
    .where(systemRecordScope(organizationId, ctx.defId, { includeArchived: true }))
    .groupBy(partValue.relatedEntityId)
  const out = new Map<string, FactTotals>()
  for (const row of rows) {
    if (!row.partId) continue
    out.set(row.partId, { count: row.n, sum: Number(row.total ?? 0) })
  }
  return out
}
