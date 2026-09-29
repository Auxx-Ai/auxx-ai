// packages/lib/src/inventory/movements/__tests__/list-movements.int.test.ts

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { describe, expect, it } from 'vitest'
import { listPartMovements } from '../list-movements'

const db = () => getTestDb() as unknown as Database

async function seedPart() {
  const org = await createTestOrganization()
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      apiSlug: 'parts',
      entityType: 'part',
      singular: 'part',
      plural: 'parts',
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityDefinition.id })
  const [part] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId: org.id, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning({ id: schema.EntityInstance.id })
  return { organizationId: org.id, partId: part!.id }
}

describe('listPartMovements', () => {
  it('pages newest first by effectiveAt and links a reversal both ways', async () => {
    const { organizationId, partId } = await seedPart()
    const day = (d: number) => new Date(Date.UTC(2026, 2, d, 12))
    const rows = await db()
      .insert(schema.StockMovement)
      .values(
        [1, 2, 3, 4, 5].map((d) => ({
          organizationId,
          partId,
          type: 'receive' as const,
          quantity: d,
          occurredAt: day(d),
        }))
      )
      .returning({ id: schema.StockMovement.id })
    const [reversal] = await db()
      .insert(schema.StockMovement)
      .values({
        organizationId,
        partId,
        type: 'receive',
        quantity: -2,
        occurredAt: day(6),
        reversesMovementId: rows[1]!.id,
      })
      .returning({ id: schema.StockMovement.id })

    const first = (
      await listPartMovements(db(), organizationId, { partId, limit: 4 })
    )._unsafeUnwrap()
    expect(first.total).toBe(6)
    expect(first.items.map((item) => item.quantity)).toEqual([-2, 5, 4, 3])
    expect(first.items[0]!.reversesMovementId).toBe(rows[1]!.id)
    expect(first.nextCursor).not.toBeNull()

    const second = (
      await listPartMovements(db(), organizationId, { partId, limit: 4, cursor: first.nextCursor })
    )._unsafeUnwrap()
    expect(second.items.map((item) => item.quantity)).toEqual([2, 1])
    expect(second.items[0]!.reversedById).toBe(reversal!.id)
    expect(second.nextCursor).toBeNull()
  })
})
