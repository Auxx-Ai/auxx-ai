// packages/lib/src/inventory/movements/__tests__/support/movement-table.ts
// A bare org with parent instances and raw `StockMovement` rows, for reader int tests.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { classifyMovement } from '../../classify'
import { readConsumptionClasses } from '../../reads'

const db = () => getTestDb() as unknown as Database

/** A movement row as a test states it; everything but the part, type and quantity is optional. */
export type MovementFixtureRow = Omit<
  typeof schema.StockMovement.$inferInsert,
  'organizationId' | 'effectiveAt'
>

/** A fresh org with `count` generic entity instances to hang movements off (parts, lines, builds). */
export async function seedMovementOrg(
  count = 4
): Promise<{ organizationId: string; ids: string[] }> {
  const org = await createTestOrganization()
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      apiSlug: `fixture-${org.id}`,
      singular: 'Fixture',
      plural: 'Fixtures',
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityDefinition.id })
  const rows = await db()
    .insert(schema.EntityInstance)
    .values(
      Array.from({ length: count }, () => ({
        organizationId: org.id,
        entityDefinitionId: def!.id,
        updatedAt: new Date(),
      }))
    )
    .returning({ id: schema.EntityInstance.id })
  return { organizationId: org.id, ids: rows.map((row) => row.id) }
}

/** Insert movements as given and return their ids, in order; an unset class is stamped as the writer would. */
export async function insertMovements(
  organizationId: string,
  rows: MovementFixtureRow[]
): Promise<string[]> {
  if (rows.length === 0) return []
  const reversed = rows.flatMap((row) => row.reversesMovementId ?? [])
  const originals = await readConsumptionClasses(db(), organizationId, reversed)
  const inserted = await db()
    .insert(schema.StockMovement)
    .values(
      rows.map((row) => ({
        ...row,
        organizationId,
        consumptionClass:
          row.consumptionClass ??
          classifyMovement(row.type, {
            reversesClass: row.reversesMovementId ? originals.get(row.reversesMovementId) : null,
            parentMovementId: row.parentMovementId,
            isSalvage: !row.reversesMovementId,
          }),
      }))
    )
    .returning({ id: schema.StockMovement.id })
  return inserted.map((row) => row.id)
}
