// packages/lib/src/data-migrations/migrations/__tests__/202-reset-builds.int.test.ts
// Migration 202 against a real database. The EAV build side is built with raw inserts, because the
// build registry entries are deleted in the same release.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import { PartKind } from '../../../resources/registry/enum-values'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { migration202ResetBuilds } from '../202-reset-builds'

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

const db = () => getTestDb() as unknown as Database
const now = () => new Date()
const AT = new Date('2026-03-15T12:00:00.000Z')

async function customField(
  organizationId: string,
  entityDefinitionId: string,
  systemAttribute: string,
  type: 'RELATIONSHIP' | 'SINGLE_SELECT'
): Promise<string> {
  const [row] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId,
      name: systemAttribute,
      type,
      systemAttribute,
      isCustom: false,
      modelType: 'entity',
      updatedAt: now(),
    })
    .returning()
  return row!.id
}

/** One posting with a subject link, optional member links and one balanced pair of lines. */
async function posting(
  organizationId: string,
  subject: { kind: string; id: string },
  members: string[],
  lineSourceId: string
): Promise<string> {
  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'inventory_movement',
      avenue: 'inventory',
      periodKey: subject.id,
      txnDate: '2026-03-15',
      totalMinor: 500,
      built: { v: 1 },
      postedAt: AT,
    })
    .returning()
  const id = row!.id
  await db()
    .insert(schema.GlPostingSource)
    .values([
      {
        organizationId,
        glPostingId: id,
        sourceKind: subject.kind,
        sourceId: subject.id,
        linkRole: 'subject',
      },
      ...members.map((sourceId) => ({
        organizationId,
        glPostingId: id,
        sourceKind: 'stock_movement',
        sourceId,
        linkRole: 'member' as const,
      })),
    ])
  await db()
    .insert(schema.GlPostingLine)
    .values(
      (['debit', 'credit'] as const).map((direction, i) => ({
        organizationId,
        glPostingId: id,
        lineNumber: i + 1,
        glAccountId: 'acct',
        direction,
        amountMinor: 500,
        sourceType: 'stock_movement',
        sourceId: lineSourceId,
      }))
    )
  return id
}

/** A transaction-mode batch holding one posting, in `state`. */
async function batch(organizationId: string, glPostingId: string, state: 'ready' | 'sent') {
  const [book] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({ organizationId, providerKey: 'quickbooks', externalCompanyId: `co-${glPostingId}` })
    .returning()
  const [connection] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId,
      bookId: book!.id,
      epoch: 1,
      credentialBindingSnapshot: 'none',
      state: 'disconnected',
      exportFromDate: '2026-01-01',
      openingPolicy: {},
    })
    .returning()
  const [row] = await db()
    .insert(schema.ExportBatch)
    .values({
      organizationId,
      bookId: book!.id,
      connectionId: connection!.id,
      mode: 'transaction',
      avenue: 'inventory',
      grainKey: glPostingId,
      currency: 'USD',
      objectType: 'journal_entry',
      payload: {},
      payloadHash: 'a'.repeat(64),
      state,
      providerObjectId: state === 'sent' ? 'qbo-1' : null,
    })
    .returning()
  await db()
    .insert(schema.ExportBatchPosting)
    .values({ organizationId, batchId: row!.id, glPostingId })
  return row!.id
}

/** An org with the parts, a hand-made `build` def, two builds and one non-build receipt. */
async function seed() {
  const org = await createTestOrganization()
  const user = await createTestUser()
  const organizationId = org.id
  const all = await createEntityDefinitions(db(), organizationId)
  const defs: EntityDefMap = new Map(
    [...all].filter(([kind]) => ['part', 'subpart'].includes(kind))
  )
  const made = await createAllFields(db(), organizationId, defs)
  await linkRelationships(db(), defs, made)
  await linkDisplayFields(db(), defs, made)
  const partDefId = defs.get('part')!.id

  const [buildDef] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: 'builds',
      singular: 'Build',
      plural: 'Builds',
      entityType: 'build',
      updatedAt: now(),
    })
    .returning()
  const buildDefId = buildDef!.id
  const buildPartField = await customField(organizationId, buildDefId, 'build_part', 'RELATIONSHIP')
  const buildStatusField = await customField(
    organizationId,
    buildDefId,
    'build_status',
    'SINGLE_SELECT'
  )
  const partBuildsField = await customField(
    organizationId,
    partDefId,
    'part_builds',
    'RELATIONSHIP'
  )

  const crud = new UnifiedCrudHandler(organizationId, user.id, db())
  const partIds: string[] = []
  for (const title of ['Mast', 'Pump']) {
    const created = await crud.create(partDefId, {
      part_title: title,
      part_sku: `SKU-${title.toUpperCase()}`,
      part_kind: PartKind.COMPONENT,
    })
    partIds.push(created.instance.id)
  }
  const [mast, pump] = partIds as [string, string]

  const buildIds: string[] = []
  for (let i = 0; i < 2; i++) {
    const [instance] = await db()
      .insert(schema.EntityInstance)
      .values({ organizationId, entityDefinitionId: buildDefId, updatedAt: now() })
      .returning()
    const id = instance!.id
    buildIds.push(id)
    await db()
      .insert(schema.FieldValue)
      .values([
        {
          organizationId,
          entityId: id,
          entityDefinitionId: buildDefId,
          fieldId: buildPartField,
          relatedEntityId: mast,
          relatedEntityDefinitionId: partDefId,
        },
        {
          organizationId,
          entityId: id,
          entityDefinitionId: buildDefId,
          fieldId: buildStatusField,
          optionId: 'completed',
        },
        {
          organizationId,
          entityId: mast,
          entityDefinitionId: partDefId,
          fieldId: partBuildsField,
          relatedEntityId: id,
          relatedEntityDefinitionId: buildDefId,
          sortKey: `a${i}`,
        },
      ])
  }
  const [built, pending] = buildIds as [string, string]

  const movement = async (
    partId: string,
    type: 'receive' | 'build_consume' | 'build_produce',
    quantity: number,
    buildId: string | null,
    parentMovementId: string | null = null
  ) => {
    const [row] = await db()
      .insert(schema.StockMovement)
      .values({
        organizationId,
        partId,
        type,
        quantity,
        buildId,
        parentMovementId,
        unitCostMinor: 250,
        extendedCostMinor: 250 * quantity,
        costBasis: 'standard',
        occurredAt: AT,
      })
      .returning()
    await db()
      .insert(schema.InventoryMovementFact)
      .values({
        id: row!.id,
        organizationId,
        partId,
        type,
        quantity,
        occurredAt: AT,
        consumptionClass: quantity > 0 ? 'supply' : 'consumption',
        buildId,
      })
    return row!.id
  }
  const receipt = await movement(pump, 'receive', 10, null)
  const consume = await movement(pump, 'build_consume', -2, built)
  const produce = await movement(mast, 'build_produce', 1, built)
  // A BOM child hanging off a build leg, with no build of its own.
  const child = await movement(pump, 'build_consume', -1, null, consume)

  const buildPosting = await posting(
    organizationId,
    { kind: 'build', id: built },
    [consume, produce],
    built
  )
  const receiptPosting = await posting(
    organizationId,
    { kind: 'stock_movement', id: receipt },
    [receipt],
    receipt
  )

  await db()
    .insert(schema.AccountingWorkItem)
    .values([
      {
        organizationId,
        sourceKind: 'build',
        sourceId: pending,
        stage: 'price',
        reasonCode: 'STANDARD_COST_MISSING',
      },
      {
        organizationId,
        sourceKind: 'stock_movement',
        sourceId: receipt,
        stage: 'price',
        reasonCode: 'STANDARD_COST_MISSING',
      },
    ])
  await db().insert(schema.RecordSequence).values({
    organizationId,
    scope: 'build',
    prefix: 'B',
    currentNumber: 42,
    updatedAt: now(),
  })

  return {
    organizationId,
    buildDefId,
    partBuildsField,
    mast,
    pump,
    buildIds,
    receipt,
    buildMovements: [consume, produce, child],
    buildPosting,
    receiptPosting,
  }
}

async function qoh(organizationId: string, partId: string): Promise<number | null> {
  const [row] = await db()
    .select({ value: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.CustomField.id, schema.FieldValue.fieldId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, partId),
        eq(schema.CustomField.systemAttribute, 'part_quantity_on_hand')
      )
    )
  return row?.value ?? null
}

const movementIds = async (organizationId: string) =>
  (
    await db()
      .select({ id: schema.StockMovement.id })
      .from(schema.StockMovement)
      .where(eq(schema.StockMovement.organizationId, organizationId))
  ).map((row) => row.id)

const postingIds = async (organizationId: string) =>
  (
    await db()
      .select({ id: schema.GlPosting.id })
      .from(schema.GlPosting)
      .where(eq(schema.GlPosting.organizationId, organizationId))
  ).map((row) => row.id)

describe('migration 202', () => {
  it('is a no-op for an org with no build def', async () => {
    const org = await createTestOrganization()
    const result = await migration202ResetBuilds.up(db(), org.id)
    expect(result.alreadyUpToDate).toBe(true)
  })

  it('deletes the org’s builds and what they produced, and nothing else', async () => {
    const s = await seed()
    const other = await seed()
    await batch(s.organizationId, s.buildPosting, 'ready')

    const result = await migration202ResetBuilds.up(db(), s.organizationId)
    expect(result).toMatchObject({
      alreadyUpToDate: false,
      buildsDeleted: 2,
      movementsDeleted: 3,
      postingsDeleted: 1,
      partsRecomputed: 2,
    })

    expect(await movementIds(s.organizationId)).toEqual([s.receipt])
    expect(await postingIds(s.organizationId)).toEqual([s.receiptPosting])
    const facts = await db()
      .select({ id: schema.InventoryMovementFact.id })
      .from(schema.InventoryMovementFact)
      .where(eq(schema.InventoryMovementFact.organizationId, s.organizationId))
    expect(facts.map((row) => row.id)).toEqual([s.receipt])
    const sources = await db()
      .select({ id: schema.GlPostingSource.glPostingId })
      .from(schema.GlPostingSource)
      .where(eq(schema.GlPostingSource.organizationId, s.organizationId))
    expect(new Set(sources.map((row) => row.id))).toEqual(new Set([s.receiptPosting]))
    const lines = await db()
      .select({ id: schema.GlPostingLine.glPostingId })
      .from(schema.GlPostingLine)
      .where(eq(schema.GlPostingLine.organizationId, s.organizationId))
    expect(new Set(lines.map((row) => row.id))).toEqual(new Set([s.receiptPosting]))
    const items = await db()
      .select({ sourceId: schema.AccountingWorkItem.sourceId })
      .from(schema.AccountingWorkItem)
      .where(eq(schema.AccountingWorkItem.organizationId, s.organizationId))
    expect(items.map((row) => row.sourceId)).toEqual([s.receipt])
    const batches = await db()
      .select({ id: schema.ExportBatch.id })
      .from(schema.ExportBatch)
      .where(eq(schema.ExportBatch.organizationId, s.organizationId))
    expect(batches).toEqual([])

    const [def] = await db()
      .select()
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, s.buildDefId))
    expect(def).toBeUndefined()
    const instances = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, s.buildIds))
    expect(instances).toEqual([])
    const mirror = await db()
      .select({ id: schema.CustomField.id })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.id, s.partBuildsField))
    expect(mirror).toEqual([])
    const values = await db()
      .select({ id: schema.FieldValue.id })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, s.organizationId),
          eq(schema.FieldValue.relatedEntityDefinitionId, s.buildDefId)
        )
      )
    expect(values).toEqual([])
    const [sequence] = await db()
      .select({ currentNumber: schema.RecordSequence.currentNumber })
      .from(schema.RecordSequence)
      .where(
        and(
          eq(schema.RecordSequence.organizationId, s.organizationId),
          eq(schema.RecordSequence.scope, 'build')
        )
      )
    // The counter runs on: rewinding it could hand out a number an in-flight insert already holds.
    expect(sequence?.currentNumber).toBe(42)

    // The receipt stands; the build's produce and consume legs are gone.
    expect(await qoh(s.organizationId, s.pump)).toBe(10)
    expect(await qoh(s.organizationId, s.mast)).toBe(0)

    // The other org is untouched.
    expect((await movementIds(other.organizationId)).sort()).toEqual(
      [other.receipt, ...other.buildMovements].sort()
    )
    expect((await postingIds(other.organizationId)).sort()).toEqual(
      [other.buildPosting, other.receiptPosting].sort()
    )
    const [otherDef] = await db()
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, other.buildDefId))
    expect(otherDef?.id).toBe(other.buildDefId)

    // A retry after a failure past the commit no longer knows the touched parts: it re-derives all.
    const again = await migration202ResetBuilds.up(db(), s.organizationId)
    expect(again).toMatchObject({ alreadyUpToDate: true, partsRecomputed: 2 })
    expect(await qoh(s.organizationId, s.pump)).toBe(10)
  })

  it('removes the legs of an EAV build that was deleted before the run', async () => {
    const s = await seed()
    await db().delete(schema.EntityInstance).where(inArray(schema.EntityInstance.id, s.buildIds))

    const result = await migration202ResetBuilds.up(db(), s.organizationId)
    expect(result).toMatchObject({ movementsDeleted: 3 })
    expect(await movementIds(s.organizationId)).toEqual([s.receipt])
    expect(await postingIds(s.organizationId)).toEqual([s.receiptPosting])
  })

  it('refuses an org whose build posting was exported, and changes nothing', async () => {
    const s = await seed()
    await batch(s.organizationId, s.buildPosting, 'sent')

    await expect(migration202ResetBuilds.up(db(), s.organizationId)).rejects.toThrow(
      new RegExp(`${s.organizationId} has 1 build posting\\(s\\) exported`)
    )

    expect((await movementIds(s.organizationId)).sort()).toEqual(
      [s.receipt, ...s.buildMovements].sort()
    )
    expect((await postingIds(s.organizationId)).sort()).toEqual(
      [s.buildPosting, s.receiptPosting].sort()
    )
    const [def] = await db()
      .select({ id: schema.EntityDefinition.id })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.id, s.buildDefId))
    expect(def?.id).toBe(s.buildDefId)
  })
})
