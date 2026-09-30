// packages/lib/src/data-migrations/migrations/__tests__/203-stock-movement-consumption-class.int.test.ts
// Migration 203 against a real database: unstamped rows get the class the writer would stamp.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  type MovementFixtureRow,
  seedMovementOrg,
} from '../../../inventory/movements/__tests__/support/movement-table'
import { type ConsumptionClass, classifyMovementRows } from '../../../inventory/movements/classify'
import { migration203StockMovementConsumptionClass } from '../203-stock-movement-consumption-class'

const db = () => getTestDb() as unknown as Database

/** Rows as a pre-column release wrote them: no class. Originals come before their reversals. */
function fixture(
  partId: string
): Array<MovementFixtureRow & { id: string; expected: ConsumptionClass }> {
  const row = (
    id: string,
    type: MovementFixtureRow['type'],
    quantity: number,
    expected: ConsumptionClass,
    links: Partial<MovementFixtureRow> = {}
  ) => ({ id: `${partId}_${id}`, partId, type, quantity, expected, ...links })
  const ref = (id: string) => `${partId}_${id}`
  return [
    row('receive', 'receive', 10, 'supply'),
    row('sale', 'sale', -1, 'consumption'),
    row('ship', 'ship', -1, 'consumption'),
    row('consume', 'build_consume', -2, 'consumption'),
    row('produce', 'build_produce', 1, 'supply'),
    row('scrap', 'scrap', -1, 'scrap'),
    row('initial', 'initial', 5, 'supply'),
    row('return_out', 'return_out', -1, 'supply'),
    row('revalue', 'revalue', 0, 'none'),
    row('adjust', 'adjust', 3, 'adjustment'),
    row('salvage', 'return_in', 1, 'supply'),
    row('child', 'sale', -1, 'adjustment', { parentMovementId: ref('adjust') }),
    row('undo_sale', 'return_in', 1, 'consumption', { reversesMovementId: ref('sale') }),
    row('redo_sale', 'return_out', -1, 'consumption', { reversesMovementId: ref('undo_sale') }),
    row('undo_child', 'return_in', 1, 'adjustment', { reversesMovementId: ref('child') }),
    row('undo_receive', 'return_out', -10, 'supply', { reversesMovementId: ref('receive') }),
  ]
}

async function insertUnstamped(organizationId: string, rows: ReturnType<typeof fixture>) {
  await db()
    .insert(schema.StockMovement)
    .values(rows.map(({ expected: _expected, ...row }) => ({ ...row, organizationId })))
}

async function classesOf(organizationId: string): Promise<Map<string, ConsumptionClass | null>> {
  const rows = await db()
    .select({ id: schema.StockMovement.id, cls: schema.StockMovement.consumptionClass })
    .from(schema.StockMovement)
    .where(eq(schema.StockMovement.organizationId, organizationId))
  return new Map(rows.map((row) => [row.id, row.cls]))
}

describe('migration 203', () => {
  it('is a no-op for an org with no movements', async () => {
    const { organizationId } = await seedMovementOrg(1)
    const result = await migration203StockMovementConsumptionClass.up(db(), organizationId)
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('stamps every row with the class the writer would, and only this org', async () => {
    const s = await seedMovementOrg(1)
    const other = await seedMovementOrg(1)
    const rows = fixture(s.ids[0]!)
    await insertUnstamped(s.organizationId, rows)
    await insertUnstamped(other.organizationId, fixture(other.ids[0]!))

    const result = await migration203StockMovementConsumptionClass.up(db(), s.organizationId)
    expect(result).toMatchObject({ movementsClassified: rows.length })

    const stamped = await classesOf(s.organizationId)
    const replayed = classifyMovementRows(rows)
    for (const row of rows) {
      expect({ id: row.id, cls: stamped.get(row.id) }).toEqual({ id: row.id, cls: row.expected })
      expect(stamped.get(row.id)).toBe(replayed.get(row.id))
    }
    expect([...(await classesOf(other.organizationId)).values()].every((c) => c === null)).toBe(
      true
    )
  })

  it('leaves a stamped row alone and a rerun finds nothing', async () => {
    const s = await seedMovementOrg(1)
    const partId = s.ids[0]!
    await db().insert(schema.StockMovement).values({
      id: 'stamped_sale',
      organizationId: s.organizationId,
      partId,
      type: 'sale',
      quantity: -1,
      consumptionClass: 'scrap',
    })
    // An unstamped reversal of a stamped original takes the stamped class.
    await db().insert(schema.StockMovement).values({
      id: 'unstamped_undo',
      organizationId: s.organizationId,
      partId,
      type: 'return_in',
      quantity: 1,
      reversesMovementId: 'stamped_sale',
    })

    const first = await migration203StockMovementConsumptionClass.up(db(), s.organizationId)
    expect(first).toMatchObject({ movementsClassified: 1 })
    const stamped = await classesOf(s.organizationId)
    expect(stamped.get('stamped_sale')).toBe('scrap')
    expect(stamped.get('unstamped_undo')).toBe('scrap')

    const again = await migration203StockMovementConsumptionClass.up(db(), s.organizationId)
    expect(again.alreadyUpToDate).toBe(true)
  })
})
