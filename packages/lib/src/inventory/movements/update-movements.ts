// packages/lib/src/inventory/movements/update-movements.ts
// The three sanctioned in-place edits of the append-only ledger (plan 20 §3.1): cost fill,
// initial re-anchor, role restamp. Nothing else updates a StockMovement row.

import { schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import { chunkArray } from '../../import/utils/chunk-array'
import { computeExtendedCost } from './client'

const CHUNK = 1000

/** One pending row's cost, in minor units at rate precision. */
export interface MovementCostFill {
  id: string
  unitCostMinor: number
}

/** A row that was filled: its stored cost, for the entry builder. */
export interface FilledMovementCost {
  id: string
  partId: string
  quantity: number
  unitCostMinor: number
  extendedCostMinor: number
  glRole: string | null
  occurredAt: Date | null
}

/**
 * Price pending rows at `standard`, once. The `costBasis = 'pending'` predicate is the claim: a row
 * already priced by a concurrent run matches nothing and is left out of the result.
 */
export async function fillPendingMovementCosts(
  tx: Transaction,
  organizationId: string,
  fills: readonly MovementCostFill[]
): Promise<FilledMovementCost[]> {
  const t = schema.StockMovement
  const filled: FilledMovementCost[] = []
  for (const fill of fills) {
    const [row] = await tx
      .select({ quantity: t.quantity })
      .from(t)
      .where(and(eq(t.organizationId, organizationId), eq(t.id, fill.id)))
    if (!row) continue
    const extendedCostMinor = computeExtendedCost(fill.unitCostMinor, row.quantity) || 0
    const [updated] = await tx
      .update(t)
      .set({ unitCostMinor: fill.unitCostMinor, extendedCostMinor, costBasis: 'standard' })
      .where(
        and(eq(t.organizationId, organizationId), eq(t.id, fill.id), eq(t.costBasis, 'pending'))
      )
      .returning({
        id: t.id,
        partId: t.partId,
        quantity: t.quantity,
        glRole: t.glRole,
        occurredAt: t.occurredAt,
      })
    if (!updated) continue
    filled.push({ ...updated, unitCostMinor: fill.unitCostMinor, extendedCostMinor })
  }
  return filled
}

/** Re-date and re-quantify a part's `initial` anchor (111 Q26); refuses any other type. */
export async function reanchorInitialMovement(
  tx: Transaction,
  organizationId: string,
  id: string,
  anchor: { occurredAt: Date; quantity: number }
): Promise<void> {
  const t = schema.StockMovement
  const rows = await tx
    .update(t)
    .set({ occurredAt: anchor.occurredAt, quantity: anchor.quantity })
    .where(and(eq(t.organizationId, organizationId), eq(t.id, id), eq(t.type, 'initial')))
    .returning({ id: t.id })
  if (rows.length === 0) {
    throw new UnprocessableEntityError('Only an initial movement can be re-anchored', { id })
  }
}

/**
 * Rewrite `glRole` from `fromRole` to `toRole` on the given rows; a row not reading `fromRole` is
 * left alone, so a re-run is a no-op. The caller holds the commit lock and checked none is posted.
 */
export async function restampMovementGlRoles(
  tx: Transaction,
  organizationId: string,
  restamp: { fromRole: string; toRole: string; ids: readonly string[] }
): Promise<number> {
  const t = schema.StockMovement
  let changed = 0
  for (const chunk of chunkArray([...new Set(restamp.ids)].sort(), CHUNK)) {
    const rows = await tx
      .update(t)
      .set({ glRole: restamp.toRole })
      .where(
        and(
          eq(t.organizationId, organizationId),
          inArray(t.id, chunk),
          eq(t.glRole, restamp.fromRole)
        )
      )
      .returning({ id: t.id })
    changed += rows.length
  }
  return changed
}
