// packages/lib/src/inventory/movements/fact/__tests__/rebuild.int.test.ts
// Replay equals live, and the drift check sees what the replay would repair.
// Run: npx vitest run --config vitest.integration.config.ts src/inventory/movements/fact

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BuildFixture, seedBuildOrg } from '../../../builds/__tests__/support/build-fixture'
import { createBuild, startBuild } from '../../../builds/build-mutations'
import { completeBuild } from '../../../builds/complete-build'
import { compareFactsToLedger } from '../drift-check'
import { rebuildMovementFacts } from '../rebuild'

vi.mock('../../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const db = () => getTestDb() as unknown as Database
const QUANTITY = 2

let f: BuildFixture

async function completedBuild(): Promise<string[]> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: QUANTITY,
  })
  if (created.isErr()) throw created.error
  const started = await startBuild(db(), f.organizationId, f.userId, {
    buildId: created.value.buildId,
  })
  if (started.isErr()) throw started.error
  const done = await completeBuild(db(), f.organizationId, f.userId, {
    buildId: created.value.buildId,
    quantityProduced: QUANTITY,
  })
  if (done.isErr()) throw done.error
  return done.value.movementIds
}

async function facts() {
  const rows = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(eq(schema.InventoryMovementFact.organizationId, f.organizationId))
  return rows
    .map(({ createdAt: _createdAt, ...row }) => row)
    .sort((a, b) => a.id.localeCompare(b.id))
}

async function fieldId(systemAttribute: string): Promise<string> {
  const [field] = await db()
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, f.organizationId),
        eq(schema.CustomField.systemAttribute, systemAttribute)
      )
    )
  if (!field) throw new Error(`fixture: no ${systemAttribute} field`)
  return field.id
}

/** A reversal written straight to the ledger, bypassing the writer and so the mirror. */
async function rawReversal(originalId: string, partId: string, quantity: number): Promise<string> {
  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.organizationId,
      entityDefinitionId: f.movementDefId,
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityInstance.id })
  const id = instance!.id
  const base = {
    organizationId: f.organizationId,
    entityId: id,
    entityDefinitionId: f.movementDefId,
    updatedAt: new Date(),
  }
  await db()
    .insert(schema.FieldValue)
    .values([
      { ...base, fieldId: await fieldId('stock_movement_part'), relatedEntityId: partId },
      { ...base, fieldId: await fieldId('stock_movement_type'), optionId: 'return_in' },
      { ...base, fieldId: await fieldId('stock_movement_quantity'), valueNumber: quantity },
      {
        ...base,
        fieldId: await fieldId('stock_movement_reverses_movement'),
        relatedEntityId: originalId,
      },
    ])
  return id
}

beforeEach(async () => {
  f = await seedBuildOrg()
})

describe('rebuildMovementFacts', () => {
  it('replays the ledger into exactly the rows the live writer produced', async () => {
    await completedBuild()
    const live = await facts()
    expect(live.length).toBe(f.componentPartIds.length + 1)

    const rebuilt = await rebuildMovementFacts(db(), f.organizationId)
    if (rebuilt.isErr()) throw rebuilt.error
    expect(rebuilt.value.inserted).toBe(live.length)
    expect(await facts()).toEqual(live)
  })

  it('classifies a reversal by its original, whatever its own type', async () => {
    const movementIds = await completedBuild()
    const live = await facts()
    const consume = live.find((row) => movementIds.includes(row.id) && row.type === 'build_consume')
    const reversalId = await rawReversal(consume!.id, consume!.partId, -consume!.quantity)

    const rebuilt = await rebuildMovementFacts(db(), f.organizationId)
    if (rebuilt.isErr()) throw rebuilt.error
    const reversal = (await facts()).find((row) => row.id === reversalId)
    expect(reversal).toMatchObject({
      type: 'return_in',
      consumptionClass: 'consumption',
      reversesMovementId: consume!.id,
    })
  })
})

describe('compareFactsToLedger', () => {
  it('reads clean when the mirror matches, and names the part when a row is missing', async () => {
    await completedBuild()
    const clean = await compareFactsToLedger(db(), f.organizationId)
    if (clean.isErr()) throw clean.error
    expect(clean.value).toEqual([])

    const partId = f.componentPartIds[0] as string
    await db()
      .delete(schema.InventoryMovementFact)
      .where(
        and(
          eq(schema.InventoryMovementFact.organizationId, f.organizationId),
          eq(schema.InventoryMovementFact.partId, partId)
        )
      )
    const drifted = await compareFactsToLedger(db(), f.organizationId)
    if (drifted.isErr()) throw drifted.error
    expect(drifted.value).toEqual([
      {
        partId,
        ledgerCount: 1,
        factCount: 0,
        ledgerSum: -(f.qtyPerUnit.get(partId) as number) * QUANTITY,
        factSum: 0,
      },
    ])
  })
})
