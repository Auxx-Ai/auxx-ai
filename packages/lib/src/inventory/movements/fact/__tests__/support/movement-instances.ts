// packages/lib/src/inventory/movements/fact/__tests__/support/movement-instances.ts
// Real `stock_movement` instance ids for mirror rows, which the id foreign key requires.

import { type Database, schema } from '@auxx/database'
import { createEntityDefinitions } from '../../../../../seed/entity-seeder/create-entity-defs'

/** The org's `stock_movement` def id, seeding the definitions (no fields) on first use. */
export async function seedMovementDef(db: Database, organizationId: string): Promise<string> {
  const defs = await createEntityDefinitions(db, organizationId)
  const def = defs.get('stock_movement')
  if (!def) throw new Error('fixture: no stock_movement entity definition was seeded')
  return def.id
}

/** Insert bare `stock_movement` instances, no field values, and return their ids. */
export async function insertMovementInstances(
  db: Database,
  organizationId: string,
  movementDefId: string,
  count = 1
): Promise<string[]> {
  const rows = await db
    .insert(schema.EntityInstance)
    .values(
      Array.from({ length: count }, () => ({
        organizationId,
        entityDefinitionId: movementDefId,
        updatedAt: new Date(),
      }))
    )
    .returning({ id: schema.EntityInstance.id })
  return rows.map((row) => row.id)
}
