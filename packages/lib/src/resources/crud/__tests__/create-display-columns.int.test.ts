// packages/lib/src/resources/crud/__tests__/create-display-columns.int.test.ts
//
// Display columns ride the `createEntity` insert, through the real handler and the real
// field-value layer. See plans/records/lean-create-and-quiet-frames.md §2.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { err } from 'neverthrow'
import pg from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEntityInstance } from '../../../entity-instances'
import { FieldValueService } from '../../../field-values'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import type { EntityDefMap } from '../../../seed/entity-seeder/types'
import { toRecordId } from '../../resource-id'
import { flushTxWriteScope } from '../tx-write-flush'
import { runInTxWrite } from '../tx-write-scope'
import { UnifiedCrudHandler } from '../unified-handler'

const h = vi.hoisted(() => ({
  publish: vi.fn<(room: unknown, event: string, data?: unknown) => Promise<boolean>>(
    async () => true
  ),
}))

vi.mock('../../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../realtime')>()),
  getRealtimeService: () => ({ publish: h.publish }),
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

// Queue-backed externals: a command against an unreachable Redis never settles.
vi.mock('../../../events/publisher', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publisher: { publish: async () => {}, publishLater: async () => {} },
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dedup/enqueue-scan')>()),
  enqueueDuplicateScan: async () => {},
}))
vi.mock('../../../files/thumbnails', () => ({
  ensureThumbnailPresets: async () => err(new Error('no thumbnail in tests')),
}))
vi.mock('../../../files/storage/queue-port', () => ({ createProductionQueuePort: () => ({}) }))

const db = () => getTestDb() as unknown as Database

/** Every SQL statement any pg client ran while `fn` executed. */
async function captureSql<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const sql: string[] = []
  const original = pg.Client.prototype.query
  const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
    this: pg.Client,
    ...args: unknown[]
  ) {
    const q = args[0]
    sql.push(typeof q === 'string' ? q : ((q as { text?: string })?.text ?? ''))
    return (original as (...a: unknown[]) => unknown).apply(this, args)
  } as never)
  try {
    return { result: await fn(), sql }
  } finally {
    spy.mockRestore()
  }
}

const count = (sql: string[], pattern: RegExp) => sql.filter((s) => pattern.test(s)).length
const INSTANCE_INSERT = /^insert into "EntityInstance"/
const columnUpdate = (column: string) =>
  new RegExp(`^update "EntityInstance" set ("updatedAt" = \\$\\d+, )?"${column}" = `)
const DISPLAY_NAME_UPDATE = columnUpdate('displayName')
const SECONDARY_UPDATE = columnUpdate('secondaryDisplayValue')
const EMPTY_PROBE = /^select "id" from "FieldValue" where .* limit/

async function storedColumns(instanceId: string) {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, instanceId))
  return {
    displayName: row!.displayName,
    secondaryDisplayValue: row!.secondaryDisplayValue,
    avatarUrl: row!.avatarUrl,
  }
}

async function seedOrg() {
  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Creator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))
  return { orgId: org.id, userId: user.id }
}

interface FieldSpec {
  type: string
  options?: unknown
}

/** A custom def whose primary display field is `field` and secondary is `sub` (TEXT unless given). */
async function customDef(
  orgId: string,
  slug: string,
  primary: FieldSpec,
  secondary: FieldSpec = { type: 'TEXT' },
  extra?: FieldSpec
) {
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: orgId,
      entityType: null,
      apiSlug: slug,
      singular: slug,
      plural: `${slug}s`,
      icon: 'box',
      color: 'blue',
      isVisible: true,
      updatedAt: new Date(),
    })
    .returning()
  const field = async (name: string, spec: FieldSpec, order: string) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: orgId,
        entityDefinitionId: def!.id,
        name,
        type: spec.type as never,
        options: (spec.options ?? null) as never,
        sortOrder: order,
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()
    return row!.id
  }
  const primaryId = await field('Main', primary, 'a1')
  const secondaryId = await field('Sub', secondary, 'a2')
  if (extra) await field('Extra', extra, 'a3')
  await db()
    .update(schema.EntityDefinition)
    .set({ primaryDisplayFieldId: primaryId, secondaryDisplayFieldId: secondaryId })
    .where(eq(schema.EntityDefinition.id, def!.id))
  return def!.id
}

beforeEach(() => {
  h.publish.mockClear()
})

describe('scalar display columns ride the insert', () => {
  const cases = [
    { label: 'TEXT', primary: { type: 'TEXT' }, main: 'Widget', sub: 'note' },
    { label: 'NUMBER', primary: { type: 'NUMBER' }, main: 12.5, sub: 'note' },
    {
      label: 'CURRENCY',
      primary: { type: 'CURRENCY', options: { currencyCode: 'EUR', decimals: 2 } },
      main: 1999,
      sub: 'note',
    },
    {
      label: 'SINGLE_SELECT',
      primary: {
        type: 'SINGLE_SELECT',
        options: { options: [{ id: 'a', value: 'a', label: 'A' }] },
      },
      main: 'a',
      sub: 'note',
    },
    { label: 'DATE', primary: { type: 'DATE' }, main: '2026-03-04', sub: 'note' },
    {
      label: 'CURRENCY secondary (org currency)',
      primary: { type: 'TEXT' },
      secondary: { type: 'CURRENCY' },
      main: 'Widget',
      sub: 250,
    },
  ]

  it.each(
    cases
  )('$label: one insert, no display UPDATE, no probe, same text as the update path', async (c) => {
    const { orgId, userId } = await seedOrg()
    const defId = await customDef(orgId, 'probe', c.primary, c.secondary)
    const crud = new UnifiedCrudHandler(orgId, userId, db())

    const { result, sql } = await captureSql(() => crud.create(defId, { Main: c.main, Sub: c.sub }))

    expect(count(sql, INSTANCE_INSERT)).toBe(1)
    expect(count(sql, DISPLAY_NAME_UPDATE)).toBe(0)
    expect(count(sql, SECONDARY_UPDATE)).toBe(0)
    expect(count(sql, EMPTY_PROBE)).toBe(0)
    const created = await storedColumns(result.instance.id)
    expect(created.displayName).not.toBeNull()
    expect(created.secondaryDisplayValue).not.toBeNull()
    expect(result.instance).toMatchObject({
      displayName: created.displayName,
      secondaryDisplayValue: created.secondaryDisplayValue,
    })

    // The reference: the same values through the post-insert path (`maybeUpdateDisplayValue`).
    const bare = (
      await createEntityInstance({ entityDefinitionId: defId, organizationId: orgId }, db())
    )._unsafeUnwrap()
    const fields = await db()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.entityDefinitionId, defId))
    const idOf = (name: string) => fields.find((f) => f.name === name)!.id
    const reference = await captureSql(() =>
      new FieldValueService(orgId, userId, db()).createValuesForEntity({
        recordId: toRecordId(defId, bare.id) as RecordId,
        values: [
          { fieldId: idOf('Main'), value: c.main },
          { fieldId: idOf('Sub'), value: c.sub },
        ],
      })
    )
    // Anti-vacuity: the old path really does pay the probe and both UPDATEs.
    expect(count(reference.sql, EMPTY_PROBE)).toBe(1)
    expect(count(reference.sql, DISPLAY_NAME_UPDATE)).toBe(1)
    expect(count(reference.sql, SECONDARY_UPDATE)).toBe(1)
    const expected = await storedColumns(bare.id)
    expect(created.displayName).toBe(expected.displayName)
    expect(created.secondaryDisplayValue).toBe(expected.secondaryDisplayValue)
  })

  it('an interactive create sends record:created with the columns and no record:updated', async () => {
    const { orgId, userId } = await seedOrg()
    const defId = await customDef(orgId, 'probe', { type: 'TEXT' })
    const crud = new UnifiedCrudHandler(orgId, userId, db())

    await crud.create(defId, { Main: 'Widget', Sub: 'note' })

    const events = h.publish.mock.calls.map(([, event, data]) => ({ event, data }))
    expect(events.filter((e) => e.event === 'record:updated')).toHaveLength(0)
    const created = events.filter((e) => e.event === 'record:created')
    expect(created).toHaveLength(1)
    expect((created[0]!.data as { record: object }).record).toMatchObject({
      displayName: 'Widget',
      secondaryDisplayValue: 'note',
    })
  })

  it('a buffered create flushes one record:created with the columns and no record:updated', async () => {
    const { orgId, userId } = await seedOrg()
    const defId = await customDef(orgId, 'probe', { type: 'TEXT' })

    const committed = await db().transaction(async (tx) =>
      runInTxWrite({ organizationId: orgId, actorUserId: userId }, () =>
        new UnifiedCrudHandler(orgId, userId, tx as never).create(defId, {
          Main: 'Widget',
          Sub: 'note',
        })
      )
    )
    expect(h.publish).not.toHaveBeenCalled()
    await flushTxWriteScope(committed.scope)

    const events = h.publish.mock.calls.map(([, event, data]) => ({ event, data }))
    expect(events.filter((e) => e.event === 'record:updated')).toHaveLength(0)
    const created = events.filter((e) => e.event === 'record:created')
    expect(created).toHaveLength(1)
    expect((created[0]!.data as { record: object }).record).toMatchObject({
      displayName: 'Widget',
      secondaryDisplayValue: 'note',
    })
  })

  it('clears the precomputed columns when the value insert is refused', async () => {
    const { orgId, userId } = await seedOrg()
    const defId = await customDef(
      orgId,
      'probe',
      { type: 'TEXT' },
      { type: 'TEXT' },
      { type: 'FILE' }
    )
    const crud = new UnifiedCrudHandler(orgId, userId, db())

    // A FILE ref to a missing asset fails the one multi-row insert, so no value is stored.
    const created = await crud.create(defId, {
      Main: 'Widget',
      Sub: 'note',
      Extra: { ref: 'asset:missing' },
    })

    expect(await storedColumns(created.instance.id)).toMatchObject({
      displayName: null,
      secondaryDisplayValue: null,
    })
  })
})

describe('display fields that stay on the post-insert path', () => {
  async function seedParts() {
    const { orgId, userId } = await seedOrg()
    const all = await createEntityDefinitions(db(), orgId)
    const defs: EntityDefMap = new Map()
    for (const t of ['part', 'subpart', 'build', 'stock_movement'] as const)
      defs.set(t, all.get(t)!)
    const fieldMap = await createAllFields(db(), orgId, defs)
    await linkRelationships(db(), defs, fieldMap)
    await linkDisplayFields(db(), defs, fieldMap)
    return {
      orgId,
      crud: new UnifiedCrudHandler(orgId, userId, db()),
      partDefId: defs.get('part')!.id,
      subpartDefId: defs.get('subpart')!.id,
    }
  }

  it('a RELATIONSHIP primary resolves after the insert; its scalar secondary rides the insert', async () => {
    const { crud, partDefId, subpartDefId } = await seedParts()
    const parent = await crud.create(partDefId, { part_title: 'Lift', part_sku: 'L-1' })
    const child = await crud.create(partDefId, { part_title: 'Bolt', part_sku: 'B-1' })

    const { result, sql } = await captureSql(() =>
      crud.create(subpartDefId, {
        subpart_parent_part: toRecordId(partDefId, parent.instance.id),
        subpart_child_part: toRecordId(partDefId, child.instance.id),
        subpart_quantity: 3,
      })
    )

    expect(count(sql, DISPLAY_NAME_UPDATE)).toBe(1)
    expect(count(sql, SECONDARY_UPDATE)).toBe(0)
    expect(await storedColumns(result.instance.id)).toMatchObject({
      displayName: 'Bolt',
      secondaryDisplayValue: '3',
    })
  })

  it('a FILE avatar resolves after the insert', async () => {
    const { orgId, crud, partDefId } = await seedParts()
    const [asset] = await db()
      .insert(schema.MediaAsset)
      .values({ organizationId: orgId, kind: 'image', updatedAt: new Date() })
      .returning()

    const { result, sql } = await captureSql(() =>
      crud.create(partDefId, {
        part_title: 'Lift',
        part_sku: 'L-1',
        part_image: { ref: `asset:${asset!.id}` },
      })
    )

    expect(count(sql, columnUpdate('avatarUrl'))).toBe(1)
    const stored = await storedColumns(result.instance.id)
    expect(stored).toMatchObject({ displayName: 'Lift', secondaryDisplayValue: 'L-1' })
    expect(stored.avatarUrl).toContain(asset!.id)
  })
})
