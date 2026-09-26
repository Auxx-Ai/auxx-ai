// packages/lib/src/resources/crud/__tests__/create-entities-batch.int.test.ts
//
// `createEntitiesBatch` against N `createEntity` calls on a user-authored def, quiet and sync
// lanes; the per-row fallback of `bulkCreate`; refusals; `createRange`; and the importer's batch
// callback (plans/mrp/12-slice-batched-backflush.md §2 tests).

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, asc, eq, inArray } from 'drizzle-orm'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { executeBatch, orderedBulkCreateResults } from '../../../import/execution/execute-batch'
import { seedBuildOrg } from '../../../inventory/builds/__tests__/support/build-fixture'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../../../record-rules/sync-manifest-collector'
import { recordNumbering } from '../../../records/record-numbering'
import { toRecordId } from '../../resource-id'
import { createEntitiesBatch } from '../create-entities-batch'
import { UnifiedCrudHandler } from '../unified-handler'
import { quietSession, type WriteSession } from '../write-origin'
import { runWithWriteSession } from '../write-session-als'

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

interface Widgets {
  organizationId: string
  userId: string
  defId: string
  partDefId: string
  partIds: string[]
  fieldIds: Record<string, string>
}

/**
 * A user-authored `widget` def: a required TEXT name (primary), a NUMBER (secondary), a select,
 * a date, and a belongs_to `part` whose inverse is a has_many list on the part.
 */
async function seedWidgets(options: { unique?: boolean } = {}): Promise<Widgets> {
  const f = await seedBuildOrg({ components: 2 })
  const org = f.organizationId
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org,
      entityType: null,
      apiSlug: 'widgets',
      singular: 'Widget',
      plural: 'Widgets',
      icon: 'box',
      color: 'blue',
      isVisible: true,
      updatedAt: new Date(),
    })
    .returning()
  const defId = def!.id
  const [buildPart, partBuilds] = await Promise.all(
    ['build_part', 'part_builds'].map(async (attr) => {
      const [row] = await db()
        .select({ options: schema.CustomField.options })
        .from(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, org),
            eq(schema.CustomField.systemAttribute, attr)
          )
        )
      return (row!.options as { relationship: Record<string, unknown> }).relationship
    })
  )
  const field = async (
    name: string,
    type: string,
    order: string,
    extra: Partial<typeof schema.CustomField.$inferInsert> = {}
  ) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org,
        entityDefinitionId: extra.entityDefinitionId ?? defId,
        modelType: 'entity',
        name,
        type: type as never,
        sortOrder: order,
        isCustom: true,
        updatedAt: new Date(),
        ...extra,
      })
      .returning()
    return row!.id
  }
  const main = await field('Main', 'TEXT', 'a1', {
    required: true,
    isUnique: options.unique ?? false,
  })
  const sub = await field('Sub', 'NUMBER', 'a2')
  const tier = await field('Tier', 'SINGLE_SELECT', 'a3', {
    options: { options: [{ id: 'gold', value: 'gold', label: 'Gold' }] },
  })
  const when = await field('When', 'DATE', 'a4')
  const forward = await field('Part', 'RELATIONSHIP', 'a5')
  const inverse = await field('Widgets', 'RELATIONSHIP', 'z9', { entityDefinitionId: f.partDefId })
  await db()
    .update(schema.CustomField)
    .set({
      options: {
        relationship: { ...buildPart, inverseResourceFieldId: `${f.partDefId}:${inverse}` },
      },
    })
    .where(eq(schema.CustomField.id, forward))
  await db()
    .update(schema.CustomField)
    .set({
      options: { relationship: { ...partBuilds, inverseResourceFieldId: `${defId}:${forward}` } },
    })
    .where(eq(schema.CustomField.id, inverse))
  await db()
    .update(schema.EntityDefinition)
    .set({ primaryDisplayFieldId: main, secondaryDisplayFieldId: sub })
    .where(eq(schema.EntityDefinition.id, defId))
  await getOrgCache().invalidateAndRecompute(org, [
    'customFields',
    'resources',
    'entityDefs',
  ] as never)
  return {
    organizationId: org,
    userId: f.userId,
    defId,
    partDefId: f.partDefId,
    partIds: [f.producedPartId, ...f.componentPartIds],
    fieldIds: { main, sub, tier, when, forward, inverse },
  }
}

function items(w: Widgets, prefix: string): Record<string, unknown>[] {
  return [0, 1, 2].map((i) => ({
    Main: `${prefix} widget ${i}`,
    Sub: 10 + i,
    Tier: i === 1 ? 'gold' : undefined,
    When: `2026-03-0${i + 1}`,
    Part: toRecordId(w.partDefId, w.partIds[i % 2]!),
  }))
}

/** Instance columns, values and part-list order of `ids`, ids and times stripped. */
async function stored(w: Widgets, ids: string[]) {
  const position = new Map(ids.map((id, index) => [id, index]))
  const instances = await db()
    .select()
    .from(schema.EntityInstance)
    .where(inArray(schema.EntityInstance.id, ids))
  const values = await db()
    .select()
    .from(schema.FieldValue)
    .where(inArray(schema.FieldValue.entityId, ids))
    .orderBy(asc(schema.FieldValue.fieldId), asc(schema.FieldValue.sortKey))
  const mirrors = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, w.fieldIds.inverse!),
        inArray(schema.FieldValue.relatedEntityId, ids)
      )
    )
    .orderBy(asc(schema.FieldValue.entityId), asc(schema.FieldValue.sortKey))
  const at = (id: string) => position.get(id) ?? -1
  return {
    instances: instances
      .map(({ id, createdAt: _c, updatedAt: _u, lastActivityAt: _l, searchText, ...rest }) => ({
        ...rest,
        at: at(id),
        searchText,
      }))
      .sort((a, b) => a.at - b.at),
    values: values
      .map(({ id: _i, createdAt: _c, updatedAt: _u, entityId, ...rest }) => ({
        ...rest,
        at: at(entityId),
      }))
      .sort((a, b) => a.at - b.at || a.fieldId.localeCompare(b.fieldId)),
    mirrors: mirrors.map((row) => [row.entityId, at(row.relatedEntityId!)]),
  }
}

describe('createEntitiesBatch stores what one createEntity per item stores', () => {
  it('a user-authored def on the quiet lane', async () => {
    const w = await seedWidgets()
    const session = quietSession('batch equivalence test')
    const perRow = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, { session })
    const rowIds: string[] = []
    for (const item of items(w, 'same'))
      rowIds.push((await perRow.create(w.defId, item)).instance.id)

    const batch = await db().transaction(async (tx) =>
      createEntitiesBatch(
        {
          db: tx as unknown as Database,
          organizationId: w.organizationId,
          userId: w.userId,
          session,
        },
        w.defId,
        items(w, 'same')
      )
    )
    const batchIds = batch._unsafeUnwrap().map((record) => record.id)

    const [a, b] = [await stored(w, rowIds), await stored(w, batchIds)]
    expect(b.instances).toEqual(a.instances)
    expect(b.values).toEqual(a.values)
    // Each part lists its widgets in create order, the batch's after the per-row ones.
    const order = (m: typeof a.mirrors) =>
      w.partIds.map((partId) => m.filter(([entityId]) => entityId === partId).map(([, at]) => at))
    expect(order(b.mirrors)).toEqual(order(a.mirrors))
    expect(b.values.length).toBeGreaterThan(9)
    expect(b.mirrors).toHaveLength(3)
  }, 120_000)

  it('a sync session captures what createEntity captures', async () => {
    const w = await seedWidgets()
    const subs = {
      [w.defId]: {
        fieldIds: new Set([w.fieldIds.main!]),
        lifecycle: { created: true, deleted: false },
      },
    }
    const sync = (collector: ManifestCollector): WriteSession => ({
      origin: { kind: 'sync', source: 'import', ref: 'job_1', collector },
      depth: 0,
    })
    const rowCollector = createManifestCollector(subs)
    const perRow = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, {
      session: sync(rowCollector),
    })
    const rowIds: string[] = []
    for (const item of items(w, 'same'))
      rowIds.push((await perRow.create(w.defId, item)).instance.id)

    const batchCollector = createManifestCollector(subs)
    const batch = await db().transaction(async (tx) =>
      runWithWriteSession(sync(batchCollector), () =>
        createEntitiesBatch(
          {
            db: tx as unknown as Database,
            organizationId: w.organizationId,
            userId: w.userId,
            session: sync(batchCollector),
          },
          w.defId,
          items(w, 'same')
        )
      )
    )
    const batchIds = batch._unsafeUnwrap().map((record) => record.id)

    const normalize = (collector: ManifestCollector, ids: string[]) => {
      let text = JSON.stringify(collector.toJson())
      ids.forEach((id, index) => {
        text = text.replaceAll(id, `REC${index}`)
      })
      return canonical(JSON.parse(text))
    }
    const expected = normalize(rowCollector, rowIds)
    expect(normalize(batchCollector, batchIds)).toEqual(expected)
    expect(expected.createdRecordIds).toHaveLength(3)
    expect(Object.keys(expected.deltas ?? {})).toHaveLength(3)
    expect(Object.keys(expected.mirrors ?? {}).length).toBeGreaterThan(0)
  }, 120_000)
})

/** Objects with sorted keys, so map insertion order does not count. */
function canonical(value: unknown): Record<string, unknown> & {
  createdRecordIds?: unknown[]
  deltas?: Record<string, unknown>
  mirrors?: Record<string, unknown>
} {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((key) => [key, walk((v as Record<string, unknown>)[key])])
      )
    }
    return v
  }
  return walk(value) as never
}

describe('bulkCreate', () => {
  it('batches an eligible def: one instance insert for every item', async () => {
    const w = await seedWidgets()
    const crud = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, {
      session: quietSession('bulk create test'),
    })
    expect(await crud.supportsBulkCreate(w.defId)).toBe(true)
    const inserts: string[] = []
    const original = pg.Client.prototype.query
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const q = args[0]
      const text = typeof q === 'string' ? q : ((q as { text?: string })?.text ?? '')
      if (/^insert into "EntityInstance"/.test(text)) inserts.push(text)
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    } as never)
    try {
      const result = await crud.bulkCreate(w.defId, items(w, 'batch'))
      expect(result.errors).toEqual([])
      expect(result.created.map((row) => row.displayName)).toEqual([
        'batch widget 0',
        'batch widget 1',
        'batch widget 2',
      ])
    } finally {
      spy.mockRestore()
    }
    expect(inserts).toHaveLength(1)
  }, 120_000)

  it('falls back item by item: one invalid item is one error, the rest are created', async () => {
    const w = await seedWidgets()
    const crud = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, {
      session: quietSession('bulk create test'),
    })
    const batch = items(w, 'batch')
    const { Main: _missing, ...invalid } = batch[1]!
    const result = await crud.bulkCreate(w.defId, [batch[0]!, invalid, batch[2]!])

    expect(result.errors).toEqual([{ index: 1, error: expect.stringContaining('Main') }])
    expect(result.created.map((row) => row.displayName)).toEqual([
      'batch widget 0',
      'batch widget 2',
    ])
    const all = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.entityDefinitionId, w.defId))
    expect(all).toHaveLength(2)
  }, 120_000)

  it('refuses a def with a unique field and writes nothing through the batch', async () => {
    const w = await seedWidgets({ unique: true })
    const crud = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, {
      session: quietSession('bulk create test'),
    })
    expect(await crud.supportsBulkCreate(w.defId)).toBe(false)
    const refused = await db().transaction(async (tx) =>
      createEntitiesBatch(
        {
          db: tx as unknown as Database,
          organizationId: w.organizationId,
          userId: w.userId,
          session: quietSession('refusal test'),
        },
        w.defId,
        items(w, 'batch')
      )
    )
    expect(refused.isErr()).toBe(true)
    const all = await db()
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(eq(schema.EntityInstance.entityDefinitionId, w.defId))
    expect(all).toEqual([])
  }, 120_000)
})

describe('the importer', () => {
  it('batches an eligible def on its sync session; row errors stay per row', async () => {
    const w = await seedWidgets()
    const collector = createManifestCollector({})
    const session: WriteSession = {
      origin: { kind: 'sync', source: 'import', ref: 'job_1', collector },
      depth: 0,
    }
    // Wired as `execute-plan-job.ts` wires it.
    const crud = new UnifiedCrudHandler(w.organizationId, w.userId, db(), undefined, { session })
    expect(await crud.supportsBulkCreate(w.defId)).toBe(true)
    const rows = items(w, 'import')
    const { Main: _missing, ...invalid } = rows[2]!
    const records = [rows[0]!, rows[1]!, invalid].map((customFields, rowIndex) => ({
      rowIndex,
      planRowId: `row-${rowIndex}`,
      data: { standardFields: {}, customFields },
    }))
    const createRecord = vi.fn(async () => ({ id: 'never' }))
    const result = await runWithWriteSession(session, () =>
      executeBatch(records, {
        organizationId: w.organizationId,
        userId: w.userId,
        entityDefinitionId: w.defId,
        strategy: 'create',
        createRecord,
        updateRecord: vi.fn(),
        bulkCreate: async (batch) =>
          orderedBulkCreateResults(
            batch.length,
            await crud.bulkCreate(
              w.defId,
              batch.map((record) => ({ ...record.standardFields, ...record.customFields }))
            )
          ),
      })
    )

    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.results[2]).toMatchObject({ rowIndex: 2, success: false })
    expect(result.results[2]?.error).toContain('Main')
    expect(createRecord).not.toHaveBeenCalled()
    // Only the rows that landed are in the manifest.
    expect(collector.toJson()?.createdRecordIds).toHaveLength(2)
  }, 120_000)
})

describe('recordNumbering.createRange', () => {
  it('hands concurrent ranges that never overlap', async () => {
    const w = await seedWidgets()
    const ranges = await Promise.all(
      [3, 5, 1, 4, 2].map((count) => recordNumbering.createRange(w.organizationId, 'build', count))
    )
    const numbers = ranges.flatMap((range) =>
      Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i)
    )
    expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    for (const range of ranges) {
      expect(range.recordNumbers).toEqual(
        Array.from(
          { length: range.last - range.first + 1 },
          (_, i) => `B-${String(range.first + i).padStart(4, '0')}`
        )
      )
    }
  }, 120_000)
})
