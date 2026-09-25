// packages/lib/src/inventory/movements/fact/__tests__/writes.int.test.ts
// The mirror row lands in the movement's own transaction, and leaves with it (plans/mrp/04-walkthroughs.md §1).
// Run: npx vitest run --config vitest.integration.config.ts src/inventory/movements/fact

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteEntityInstances } from '../../../../entity-instances/delete-entity-instance'
import {
  type BuildFixture,
  listMovementInstanceIds,
  seedBuildOrg,
} from '../../../builds/__tests__/support/build-fixture'
import { createBuild, startBuild } from '../../../builds/build-mutations'
import { completeBuild } from '../../../builds/complete-build'
import { deleteMovementFacts, insertMovementFacts, updateMovementFactAnchor } from '../writes'
import { insertMovementInstances } from './support/movement-instances'

vi.mock('../../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const h = vi.hoisted(() => ({ failOnFinishedGoodGlAccount: false }))

// Throwing on the produce row's GL role fails the completion after every consume row is written.
vi.mock('../../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../client')>()
  return {
    ...actual,
    resolveInventoryRoleForPartKind: (
      kind: Parameters<typeof actual.resolveInventoryRoleForPartKind>[0]
    ) => {
      if (h.failOnFinishedGoodGlAccount && kind === 'finished_good') {
        throw new Error('injected failure between the consume rows and the produce row')
      }
      return actual.resolveInventoryRoleForPartKind(kind)
    },
  }
})

const db = () => getTestDb() as unknown as Database
const QUANTITY = 4

let f: BuildFixture

async function inProgressBuild(): Promise<string> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: QUANTITY,
  })
  if (created.isErr()) throw created.error
  const started = await startBuild(db(), f.organizationId, f.userId, {
    buildId: created.value.buildId,
  })
  if (started.isErr()) throw started.error
  return created.value.buildId
}

async function facts() {
  return db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(eq(schema.InventoryMovementFact.organizationId, f.organizationId))
}

beforeEach(async () => {
  h.failOnFinishedGoodGlAccount = false
  f = await seedBuildOrg()
})

describe('writeStockMovements writes the mirror', () => {
  it('a completed build is in the mirror the moment it commits', async () => {
    const buildId = await inProgressBuild()
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY,
    })
    if (done.isErr()) throw done.error

    const rows = await facts()
    expect(rows.map((row) => row.id).sort()).toEqual([...done.value.movementIds].sort())
    for (const partId of f.componentPartIds) {
      const row = rows.find((r) => r.partId === partId)
      expect(row).toMatchObject({
        type: 'build_consume',
        consumptionClass: 'consumption',
        quantity: -(f.qtyPerUnit.get(partId) as number) * QUANTITY,
        buildId,
      })
    }
    expect(rows.find((r) => r.partId === f.producedPartId)).toMatchObject({
      type: 'build_produce',
      consumptionClass: 'supply',
      quantity: QUANTITY,
      buildId,
    })
  })

  it('a completion that fails partway leaves no mirror rows behind', async () => {
    const buildId = await inProgressBuild()
    h.failOnFinishedGoodGlAccount = true
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY,
    })
    expect(done.isErr()).toBe(true)
    expect(await listMovementInstanceIds(f.organizationId, f.movementDefId)).toEqual([])
    expect(await facts()).toEqual([])
  })

  it('deleting the movement instance cascades to its mirror row', async () => {
    const buildId = await inProgressBuild()
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY,
    })
    if (done.isErr()) throw done.error
    const [first, ...rest] = done.value.movementIds
    const deleted = await deleteEntityInstances({
      ids: [first as string],
      organizationId: f.organizationId,
      db: db(),
    })
    if (deleted.isErr()) throw deleted.error
    expect((await facts()).map((row) => row.id).sort()).toEqual([...rest].sort())
  })
})

describe('the mirror writers', () => {
  const row = {
    id: '',
    partId: 'part_1',
    type: 'initial',
    quantity: 5,
    occurredAt: null,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    consumptionClass: 'supply' as const,
  }

  beforeEach(async () => {
    const [id] = await insertMovementInstances(db(), f.organizationId, f.movementDefId)
    row.id = id as string
  })

  it('falls back to createdAt and inserts idempotently', async () => {
    expect(await insertMovementFacts(db(), f.organizationId, [row])).toBe(1)
    expect(await insertMovementFacts(db(), f.organizationId, [row])).toBe(0)
    const [stored] = await facts()
    expect(stored?.occurredAt.toISOString()).toBe('2026-09-01T10:00:00.000Z')
  })

  it('re-anchors an initial row and deletes by id', async () => {
    await insertMovementFacts(db(), f.organizationId, [row])
    await updateMovementFactAnchor(db(), row.id, {
      occurredAt: new Date('2026-08-31T00:00:00Z'),
      quantity: 7,
    })
    const [stored] = await facts()
    expect(stored).toMatchObject({ quantity: 7 })
    expect(stored?.occurredAt.toISOString()).toBe('2026-08-31T00:00:00.000Z')
    await deleteMovementFacts(db(), [row.id])
    expect(await facts()).toEqual([])
  })
})
