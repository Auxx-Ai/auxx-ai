// packages/lib/src/field-values/__tests__/display-column-frames.int.test.ts
//
// `record:updated` display-column frames through the REAL field-value layer (door-conformance
// stubs the value writers, which hid this leak). See plans/realtime/sync-record-event-flood.md P1.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import type { RecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManifestCollector } from '../../record-rules/sync-manifest-collector'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite } from '../../resources/crud/tx-write-scope'
import { quietSession, type WriteSession } from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import { createValuesForEntity } from '../create-values'
import { createFieldValueContext } from '../field-value-helpers'
import { setValuesForEntity } from '../field-value-mutations'

const db = () => getTestDb() as never as Database

const h = vi.hoisted(() => ({
  publish: vi.fn<(room: unknown, event: string, data?: unknown) => Promise<boolean>>(
    async () => true
  ),
  display: { primary: '', secondary: '' },
}))

vi.mock('../../realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime')>()),
  getRealtimeService: () => ({ publish: h.publish }),
  publishFieldValueUpdates: vi.fn(async () => {}),
  publishRecordsChanged: vi.fn(async () => {}),
  publishRecordsInvalidated: vi.fn(async () => {}),
}))

vi.mock('../../realtime/publish-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../realtime/publish-helpers')>()),
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => false),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn(() => []),
  getFieldTypeChangeHooks: vi.fn(() => []),
  getFieldPreHooks: vi.fn(() => []),
}))

vi.mock('../../field-hooks/collect-triggers', () => ({
  collectTriggeredFields: vi.fn(async () => []),
  deduplicateBySystemAttribute: vi.fn((fields: unknown[]) => fields),
}))

vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database
  const { eq: eqOp, and: andOp } = require('drizzle-orm')

  const fieldsForOrg = async (orgId: string) =>
    await tdb()
      .select()
      .from(schema.CustomField)
      .where(eqOp(schema.CustomField.organizationId, orgId))

  const resourceFor = async (orgId: string, defId: string) => {
    const [def] = await tdb()
      .select()
      .from(schema.EntityDefinition)
      .where(
        andOp(
          eqOp(schema.EntityDefinition.id, defId),
          eqOp(schema.EntityDefinition.organizationId, orgId)
        )
      )
    if (!def) return null
    return {
      id: def.id,
      entityDefinitionId: def.id,
      apiSlug: def.apiSlug,
      entityType: def.entityType,
      display: {
        primaryDisplayField: { id: h.display.primary },
        secondaryDisplayField: { id: h.display.secondary },
        avatarField: null,
      },
    }
  }

  return {
    getOrgCache: () => ({
      from: (orgId: string) => ({
        all: async () => {
          const grouped: Record<string, unknown[]> = {}
          for (const f of await fieldsForOrg(orgId)) {
            const key = f.entityDefinitionId ?? '_'
            grouped[key] = grouped[key] ?? []
            grouped[key]!.push(f)
          }
          return grouped
        },
        byId: async (fieldId: string) =>
          (await fieldsForOrg(orgId)).find((f) => f.id === fieldId) ?? null,
        bySystemAttribute: async (attr: string) =>
          (await fieldsForOrg(orgId)).find((f) => f.systemAttribute === attr) ?? null,
      }),
    }),
    getCachedResource: resourceFor,
    findCachedResource: resourceFor,
    getCachedResources: async () => [],
    getCachedFieldMap: async (orgId: string) =>
      new Map((await fieldsForOrg(orgId)).map((f) => [f.id, f])),
    getCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    requireCachedEntityDefId: async (_orgId: string, slugOrId: string) => slugOrId,
    getAllCachedCustomFields: fieldsForOrg,
    getCachedRecordRules: async () => [],
    getCachedResourceFields: async () => [],
    getCachedUserInstanceGrants: async () => [],
    getCachedMembersByUserIds: async () => [],
    getCachedAgentsByUserIds: async () => [],
    canonicalizeEntityDefinitionId: async (_orgId: string, defId: string) => defId,
  }
})

interface Fixture {
  orgId: string
  recordId: RecordId
  instanceId: string
  nameFieldId: string
  emailFieldId: string
}

async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()
  const field = async (name: string, sortOrder: string) => {
    const [row] = await db()
      .insert(schema.CustomField)
      .values({
        organizationId: org.id,
        entityDefinitionId: def!.id,
        modelType: 'contact',
        name,
        type: 'TEXT',
        sortOrder,
        isCustom: true,
        updatedAt: new Date(),
      })
      .returning()
    return row!.id
  }
  const nameFieldId = await field('Name', 'a1')
  const emailFieldId = await field('Email', 'a2')
  h.display.primary = nameFieldId
  h.display.secondary = emailFieldId
  const [inst] = await db()
    .insert(schema.EntityInstance)
    .values({ organizationId: org.id, entityDefinitionId: def!.id, updatedAt: new Date() })
    .returning()
  return {
    orgId: org.id,
    recordId: `${def!.id}:${inst!.id}` as RecordId,
    instanceId: inst!.id,
    nameFieldId,
    emailFieldId,
  }
}

const syncSession = (): WriteSession => ({
  origin: {
    kind: 'sync',
    source: 'connector',
    ref: 'run-1',
    collector: {
      recordTouched: () => {},
      hasCreated: () => false,
      subscriptionsFor: () => undefined,
    } as unknown as ManifestCollector,
  },
  depth: 0,
})

const recordUpdatedFrames = () =>
  h.publish.mock.calls.filter(([, event]) => event === 'record:updated')

async function storedDisplay(f: Fixture) {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, f.instanceId))
  return { displayName: row!.displayName, secondary: row!.secondaryDisplayValue }
}

const displayValues = (f: Fixture, name: string, email: string) => [
  { fieldId: f.nameFieldId, value: name },
  { fieldId: f.emailFieldId, value: email },
]

beforeEach(() => {
  h.publish.mockClear()
})

describe('P1 — display-column frames respect the write origin', () => {
  it('a sync-session create setting both display fields publishes no record:updated', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db(), undefined, {
      session: syncSession(),
    })

    await createValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Ada', 'ada@example.com'),
    })

    expect(await storedDisplay(f)).toEqual({ displayName: 'Ada', secondary: 'ada@example.com' })
    expect(recordUpdatedFrames()).toHaveLength(0)
  })

  it('an ambient sync session (no ctx session) publishes no record:updated', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db())

    await runWithWriteSession(syncSession(), () =>
      setValuesForEntity(ctx, {
        recordId: f.recordId,
        values: displayValues(f, 'Ada', 'ada@example.com'),
      })
    )

    expect(await storedDisplay(f)).toEqual({ displayName: 'Ada', secondary: 'ada@example.com' })
    expect(recordUpdatedFrames()).toHaveLength(0)
  })

  it('an absorbed bulk-edit session still publishes the display frames', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db(), undefined, {
      session: {
        origin: { kind: 'interactive', userId: 'user-1' },
        depth: 0,
        mode: { kind: 'absorbed', by: 'setBulkValues' },
      },
    })

    await setValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Ada', 'ada@example.com'),
      publishEvents: false,
    })

    const frames = recordUpdatedFrames()
    expect(frames).toHaveLength(2)
    // The two display writes are not ordered relative to each other.
    expect(frames.map(([, , data]) => (data as { record: object }).record)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: f.instanceId, displayName: 'Ada' }),
        expect.objectContaining({ id: f.instanceId, secondaryDisplayValue: 'ada@example.com' }),
      ])
    )
  })
})

describe('covered quiet sessions — the caller announces the rows', () => {
  it('a coveredBy quiet create publishes no record:updated', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db(), undefined, {
      session: quietSession('build completion', { coveredBy: 'publishQuietBuildWrites' }),
    })

    await createValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Ada', 'ada@example.com'),
    })

    expect(await storedDisplay(f)).toEqual({ displayName: 'Ada', secondary: 'ada@example.com' })
    expect(recordUpdatedFrames()).toHaveLength(0)
  })

  it('an ambient coveredBy quiet update publishes no record:updated', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db())

    await runWithWriteSession(
      quietSession('build completion', { coveredBy: 'publishQuietBuildWrites' }),
      () =>
        setValuesForEntity(ctx, {
          recordId: f.recordId,
          values: displayValues(f, 'Ada', 'ada@example.com'),
        })
    )

    expect(await storedDisplay(f)).toEqual({ displayName: 'Ada', secondary: 'ada@example.com' })
    expect(recordUpdatedFrames()).toHaveLength(0)
  })

  it('a plain quiet session (the avatar path) still publishes the display frames', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db(), undefined, {
      session: quietSession('connector avatar'),
    })

    await setValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Ada', 'ada@example.com'),
    })

    expect(recordUpdatedFrames()).toHaveLength(2)
  })
})

describe('P1 — display-column frames under a buffered scope', () => {
  it('a rolled-back scope publishes nothing', async () => {
    const f = await seed()

    await expect(
      db().transaction(async (tx) => {
        await runInTxWrite({ organizationId: f.orgId, actorUserId: 'user-1' }, () =>
          setValuesForEntity(createFieldValueContext(f.orgId, 'user-1', tx as never), {
            recordId: f.recordId,
            values: displayValues(f, 'Ada', 'ada@example.com'),
          })
        )
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')

    expect(recordUpdatedFrames()).toHaveLength(0)
  })

  it('a committed scope publishes exactly one merged record:updated, after the flush', async () => {
    const f = await seed()

    const committed = await db().transaction(async (tx) =>
      runInTxWrite({ organizationId: f.orgId, actorUserId: 'user-1' }, () =>
        setValuesForEntity(createFieldValueContext(f.orgId, 'user-1', tx as never), {
          recordId: f.recordId,
          values: displayValues(f, 'Ada', 'ada@example.com'),
        })
      )
    )
    expect(recordUpdatedFrames()).toHaveLength(0)

    await flushTxWriteScope(committed.scope)

    const frames = recordUpdatedFrames()
    expect(frames).toHaveLength(1)
    expect((frames[0]![2] as { record: object }).record).toMatchObject({
      id: f.instanceId,
      recordId: f.recordId,
      displayName: 'Ada',
      secondaryDisplayValue: 'ada@example.com',
    })
  })
})

describe('createValuesForEntity on an instance that already holds values', () => {
  it('without freshInstance, the probe finds the rows and the write reconciles', async () => {
    const f = await seed()
    const ctx = createFieldValueContext(f.orgId, 'user-1', db())
    await setValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Ada', 'ada@example.com'),
    })

    await createValuesForEntity(ctx, {
      recordId: f.recordId,
      values: displayValues(f, 'Grace', 'grace@example.com'),
    })

    const rows = await db()
      .select({ fieldId: schema.FieldValue.fieldId, value: schema.FieldValue.valueText })
      .from(schema.FieldValue)
      .where(eq(schema.FieldValue.entityId, f.instanceId))
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(
      expect.arrayContaining([
        { fieldId: f.nameFieldId, value: 'Grace' },
        { fieldId: f.emailFieldId, value: 'grace@example.com' },
      ])
    )
    expect(await storedDisplay(f)).toEqual({ displayName: 'Grace', secondary: 'grace@example.com' })
  })
})
