// packages/lib/src/inventory/builds/__tests__/batched-completion.int.test.ts
//
// The batched movement writer and the one-pass completed build store exactly what the per-row
// CRUD path stores (plans/mrp/10-batched-build-writes.md §5). Each case completes two identical
// builds in one org, one per path, and compares everything but ids and timestamps.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { toRecordId } from '../../../resources/resource-id'
import { createBuild, startBuild } from '../build-mutations'
import { completeBuild, recordCompletedBuild } from '../complete-build'
import type { CompleteBuildResult } from '../types'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'

const db = () => getTestDb() as unknown as Database

vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: async () => true }),
}))

const h = vi.hoisted(() => ({
  /** Route completions through the per-row CRUD writer, as before the batch. */
  legacy: false,
  failPosting: false,
  /** Every entry a completion handed the poster. */
  posts: [] as Array<{ subject: { sourceId: string } } & Record<string, unknown>>,
}))

vi.mock('../../movements/write-movements-batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../movements/write-movements-batch')>()
  const { writeStockMovements } = await import('../../movements/write-movements')
  return {
    ...actual,
    writeStockMovementsBatch: (...args: Parameters<typeof actual.writeStockMovementsBatch>) =>
      h.legacy ? writeStockMovements(...args) : actual.writeStockMovementsBatch(...args),
  }
})

vi.mock('../../../accounting/ledger/post/post-inventory-movement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../accounting/ledger/post/post-inventory-movement')>()
  return {
    ...actual,
    postInventoryMovementInTx: (...args: Parameters<typeof actual.postInventoryMovementInTx>) => {
      if (h.failPosting) throw new Error('injected posting failure')
      h.posts.push(args[1] as unknown as (typeof h.posts)[number])
      return actual.postInventoryMovementInTx(...args)
    },
  }
})

let f: BuildFixture

beforeEach(async () => {
  h.legacy = false
  h.failPosting = false
  h.posts = []
})

const COMPLETED_AT = new Date('2026-03-31T23:59:59.999Z')

/** A `planned` build started, ready for `completeBuild`. */
async function startedBuild(quantity: number): Promise<string> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: quantity,
  })
  if (created.isErr()) throw created.error
  const started = await startBuild(db(), f.organizationId, f.userId, {
    buildId: created.value.buildId,
  })
  if (started.isErr()) throw started.error
  return created.value.buildId
}

async function complete(
  legacy: boolean,
  quantityProduced: number,
  quantityScrapped = 0
): Promise<CompleteBuildResult> {
  const buildId = await startedBuild(quantityProduced)
  h.legacy = legacy
  const done = await completeBuild(db(), f.organizationId, f.userId, {
    buildId,
    quantityProduced,
    quantityScrapped,
    completedAt: COMPLETED_AT,
  })
  h.legacy = false
  if (done.isErr()) throw done.error
  return done.value
}

async function fieldIds(attributes: string[]): Promise<Record<string, string>> {
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes(attributes as never)
  return Object.fromEntries(
    attributes.map((attr) => [attr, (fields as Record<string, { id: string } | null>)[attr]?.id])
  ) as Record<string, string>
}

/** Instances, values, mirror rows, facts and the GL entry of one build's ledger, ids and times stripped. */
async function ledgerSnapshot(result: CompleteBuildResult): Promise<string> {
  const { buildId, movementIds } = result
  const ids = await fieldIds(['build_movements', 'part_stock_movements'])

  const instances = await db()
    .select({
      id: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
      secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
      searchText: schema.EntityInstance.searchText,
      createdById: schema.EntityInstance.createdById,
      avatarUrl: schema.EntityInstance.avatarUrl,
      archivedAt: schema.EntityInstance.archivedAt,
    })
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.id, movementIds))
  const values = await db()
    .select()
    .from(schema.FieldValue)
    .where(inArray(schema.FieldValue.entityId, movementIds))
    .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
  const buildMirror = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, buildId),
        eq(schema.FieldValue.fieldId, ids.build_movements!)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))
  const partMirror = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, ids.part_stock_movements!),
        inArray(schema.FieldValue.relatedEntityId, movementIds)
      )
    )
    .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.sortKey))
  const facts = await db()
    .select()
    .from(schema.InventoryMovementFact)
    .where(inArray(schema.InventoryMovementFact.id, movementIds))
  // The fixture keeps no books, so the entry is compared as the build hands it to the poster.
  const posted = h.posts.find((post) => post.subject.sourceId === buildId) ?? null

  const [build] = await db()
    .select({ displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, buildId))

  const byId = (id: string) => movementIds.indexOf(id)
  const stripped = {
    instances: [...instances]
      .sort((a, b) => byId(a.id) - byId(b.id))
      .map(({ id: _id, ...rest }) => rest),
    values: [...values]
      .sort((a, b) => byId(a.entityId) - byId(b.entityId))
      .map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => rest),
    buildMirror: buildMirror.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => rest),
    // Part lists already hold the other build's rows, so compare order, not literal keys.
    partMirror: partMirror.map(
      ({ id: _id, createdAt: _c, updatedAt: _u, sortKey: _s, ...rest }) => rest
    ),
    facts: [...facts]
      .sort((a, b) => byId(a.id) - byId(b.id))
      .map(({ createdAt: _c, ...rest }) => rest),
    posted,
  }
  let text = JSON.stringify(stripped)
  movementIds.forEach((id, index) => {
    text = text.replaceAll(id, `MV${index}`)
  })
  text = text.replaceAll(buildId, 'BUILD')
  if (build?.displayName) text = text.replaceAll(build.displayName, 'BNUM')
  return text
}

async function quantitiesOnHand(): Promise<number[]> {
  const ids = await fieldIds(['part_quantity_on_hand'])
  const partIds = [f.producedPartId, ...f.componentPartIds]
  const rows = await db()
    .select({ entityId: schema.FieldValue.entityId, value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, ids.part_quantity_on_hand!),
        inArray(schema.FieldValue.entityId, partIds)
      )
    )
  return partIds.map((id) => Number(rows.find((row) => row.entityId === id)?.value ?? 0))
}

/** Complete the same build by both paths and compare the two ledgers and their QoH deltas. */
async function expectEquivalent(quantityProduced: number, quantityScrapped = 0) {
  const before = await quantitiesOnHand()
  const legacy = await complete(true, quantityProduced, quantityScrapped)
  const middle = await quantitiesOnHand()
  const batched = await complete(false, quantityProduced, quantityScrapped)
  const after = await quantitiesOnHand()

  expect(batched.movementIds).toHaveLength(legacy.movementIds.length)
  expect(await ledgerSnapshot(batched)).toEqual(await ledgerSnapshot(legacy))
  expect(after.map((qoh, i) => qoh - middle[i]!)).toEqual(middle.map((qoh, i) => qoh - before[i]!))
  expect({ ...batched, buildId: '', recordId: '', movementIds: [] }).toEqual({
    ...legacy,
    buildId: '',
    recordId: '',
    movementIds: [],
  })
  return { legacy, batched }
}

describe('the batched completion stores what the per-row path stores', () => {
  it('a costed build', async () => {
    f = await seedBuildOrg({ components: 3 })
    const { batched } = await expectEquivalent(10)
    expect(batched.materialCost).not.toBeNull()
    expect(h.posts).toHaveLength(2)
  })

  it('a pending build (one uncosted leg)', async () => {
    f = await seedBuildOrg({ components: 3 })
    const ids = await fieldIds(['part_standard_cost'])
    await db()
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, f.componentPartIds[1]!),
          eq(schema.FieldValue.fieldId, ids.part_standard_cost!)
        )
      )
    const { batched } = await expectEquivalent(4)
    expect(batched.pendingPartIds).toEqual([f.componentPartIds[1]])
  })

  it('a subassembly produce, its account from the part kind', async () => {
    f = await seedBuildOrg({ components: 2 })
    const crud = new UnifiedCrudHandler(f.organizationId, f.userId, db())
    await crud.update(toRecordId(f.partDefId, f.producedPartId), {
      part_kind: PartKind.SUBASSEMBLY,
    })
    await expectEquivalent(6)
  })

  it('a scrapped quantity', async () => {
    f = await seedBuildOrg({ components: 3 })
    const { batched } = await expectEquivalent(8, 2)
    expect(batched.quantityScrapped).toBe(2)
  })
})

/** Every SQL statement any pg client ran while `fn` executed. */
async function countStatements(fn: () => Promise<unknown>): Promise<number> {
  let count = 0
  const original = pg.Client.prototype.query
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    count += 1
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as never)
  try {
    await fn()
  } finally {
    spy.mockRestore()
  }
  return count
}

describe('statements per completion', () => {
  it('a five-component completion stays under a fixed bound', async () => {
    f = await seedBuildOrg({ components: 5 })
    const legacyId = await startedBuild(10)
    const batchedId = await startedBuild(10)

    h.legacy = true
    const legacy = await countStatements(() =>
      completeBuild(db(), f.organizationId, f.userId, { buildId: legacyId, quantityProduced: 10 })
    )
    h.legacy = false
    const batched = await countStatements(() =>
      completeBuild(db(), f.organizationId, f.userId, { buildId: batchedId, quantityProduced: 10 })
    )
    console.info(`completeBuild statements, 5 components: per-row ${legacy}, batched ${batched}`)
    // ~10 are the movement writes; the rest are the plan reads, the build update and the QoH re-sum.
    expect(batched).toBeLessThan(55)
    expect(batched).toBeLessThan(legacy)
  })
})

describe('recordCompletedBuild — raise, start and complete in one transaction', () => {
  const input = {
    source: 'backflush' as const,
    batchRun: 7,
    completedAt: COMPLETED_AT,
    notes: 'Backflush for 2026-03-31',
  }

  /** The build record's instance columns and values, ids, times and its own number stripped. */
  async function buildSnapshot(buildId: string): Promise<string> {
    const ids = await fieldIds(['build_started_at', 'build_movements'])
    const [instance] = await db()
      .select({
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
        searchText: schema.EntityInstance.searchText,
        createdById: schema.EntityInstance.createdById,
      })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.id, buildId))
    const values = await db()
      .select()
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, buildId))
      .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
    const text = JSON.stringify({
      instance,
      values: values
        // `startBuild` stamps the wall clock; the mirror rows are compared in the ledger snapshot.
        .filter((v) => v.fieldId !== ids.build_started_at && v.fieldId !== ids.build_movements)
        .map(({ id: _id, createdAt: _c, updatedAt: _u, entityId: _e, ...rest }) => rest),
      startedAt: values.some((v) => v.fieldId === ids.build_started_at),
    })
    return instance?.displayName ? text.replaceAll(instance.displayName, 'BNUM') : text
  }

  it('stores the build and its ledger as create + start + complete do', async () => {
    f = await seedBuildOrg({ components: 3 })

    h.legacy = true
    const created = await createBuild(db(), f.organizationId, f.userId, {
      partId: f.producedPartId,
      quantityPlanned: 5,
      source: input.source,
      batchRun: input.batchRun,
      notes: input.notes,
    })
    if (created.isErr()) throw created.error
    const started = await startBuild(db(), f.organizationId, f.userId, {
      buildId: created.value.buildId,
    })
    if (started.isErr()) throw started.error
    const legacy = await completeBuild(db(), f.organizationId, f.userId, {
      buildId: created.value.buildId,
      quantityProduced: 5,
      completedAt: input.completedAt,
    })
    h.legacy = false
    if (legacy.isErr()) throw legacy.error

    const onePass = await recordCompletedBuild(db(), f.organizationId, f.userId, {
      ...input,
      partId: f.producedPartId,
      quantity: 5,
    })
    if (onePass.isErr()) throw onePass.error

    expect(await buildSnapshot(onePass.value.buildId)).toEqual(
      await buildSnapshot(legacy.value.buildId)
    )
    expect(await ledgerSnapshot(onePass.value)).toEqual(await ledgerSnapshot(legacy.value))
  })

  it('leaves no build behind when the completion is refused', async () => {
    f = await seedBuildOrg({ components: 3 })
    h.failPosting = true
    const refused = await recordCompletedBuild(db(), f.organizationId, f.userId, {
      ...input,
      partId: f.producedPartId,
      quantity: 5,
    })
    expect(refused.isErr()).toBe(true)

    const left = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.organizationId, f.organizationId),
          inArray(schema.EntityInstance.entityDefinitionId, [f.buildDefId, f.movementDefId])
        )
      )
    expect(left).toEqual([])
  })
})
