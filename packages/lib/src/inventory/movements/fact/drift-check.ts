// packages/lib/src/inventory/movements/fact/drift-check.ts

import { type Database, schema } from '@auxx/database'
import { count, eq, sum } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { guard } from '../guard'
import { type FactTotals, readFactTotalsByPart } from './reads'

/** A part whose mirror disagrees with the `StockMovement` ledger on row count or quantity. */
export interface MovementFactDrift {
  partId: string
  ledgerCount: number
  factCount: number
  ledgerSum: number
  factSum: number
}

const EPSILON = 1e-9

/** Every part where the mirror's count or signed sum differs from the `StockMovement` ledger (the `mirror_drift` signal). */
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

/** Count and SUM of quantity per part over every movement; unlike `qoh.ts` it keeps `adjustSubparts` rows, as the mirror does. */
async function readLedgerTotals(
  db: Database,
  organizationId: string
): Promise<Map<string, FactTotals>> {
  const t = schema.StockMovement
  const rows = await db
    .select({ partId: t.partId, n: count(), total: sum(t.quantity) })
    .from(t)
    .where(eq(t.organizationId, organizationId))
    .groupBy(t.partId)
  return new Map(rows.map((row) => [row.partId, { count: row.n, sum: Number(row.total ?? 0) }]))
}
