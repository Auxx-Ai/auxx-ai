// packages/lib/src/data-connectors/sinks/__tests__/entity-sink-managed-fields.int.test.ts
// The sink against the real write path (registry order def, real UnifiedCrudHandler): which
// fields land in `managedFields`, and whether an unchanged record skips on the second sync.
// Needs the real org cache, so it cannot live in entity-sink-drift-pin.int.test.ts.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import type { CachedField } from '../../../field-values/types'
import { runNormalize } from '../../../geocoding/address-normalize-hook'
import { loadManifestCollector } from '../../../record-rules/sync-manifest-collector'
import { UnifiedCrudHandler } from '../../../resources/crud/unified-handler'
import type { WriteSession } from '../../../resources/crud/write-origin'
import { toRecordId } from '../../../resources/resource-id'
import { createEntityDefinitions } from '../../../seed/entity-seeder/create-entity-defs'
import { createAllFields } from '../../../seed/entity-seeder/create-fields'
import { linkDisplayFields } from '../../../seed/entity-seeder/link-display-fields'
import { linkNameFields } from '../../../seed/entity-seeder/link-name-fields'
import { linkRelationships } from '../../../seed/entity-seeder/link-relationships'
import { newRecordFailureTally } from '../../record-failure-tally'
import { type DecodedMapping, decodeMapping, newRunCounters, openRun } from '../../service'
import type { FieldMapping } from '../../types'
import { entitySink } from '../entity-sink'
import type { ProjectedRecord, SyncCtx } from '../types'

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
vi.mock('../../../geocoding/geocoder', () => ({
  geocodeStructured: async () => ({
    lat: 40.7,
    lng: -74,
    components: {},
    placeName: 'New York',
    relevance: 0.95,
  }),
}))

const db = () => getTestDb() as unknown as Database

interface Fixture {
  orgId: string
  userId: string
  defId: string
  connector: typeof schema.DataConnector.$inferSelect
  mapping: DecodedMapping
  fieldId: (attr: string) => string
  ref: (attr: string) => ResourceFieldId
}

/** An org with the registry's order def and one contributing order mapping. */
async function seed(): Promise<Fixture> {
  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Sync Operator' })
  await db()
    .update(schema.Organization)
    .set({ systemUserId: user.id })
    .where(eq(schema.Organization.id, org.id))
  const defMap = await createEntityDefinitions(db(), org.id)
  const fieldMap = await createAllFields(db(), org.id, defMap)
  await linkRelationships(db(), defMap, fieldMap)
  await linkNameFields(db(), fieldMap)
  await linkDisplayFields(db(), defMap, fieldMap)
  const defId = defMap.get('order')!.id
  const fields = await db()
    .select()
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, org.id),
        eq(schema.CustomField.entityDefinitionId, defId)
      )
    )
  await getOrgCache().invalidateAndRecompute(org.id, [
    'customFields',
    'resources',
    'entityDefs',
  ] as never)
  const fieldId = (attr: string) => {
    const f = fields.find((r) => r.systemAttribute === attr)
    if (!f) throw new Error(`fixture: order has no ${attr}`)
    return f.id
  }
  const ref = (attr: string) => toResourceFieldId(defId, fieldId(attr))

  const [connector] = await db()
    .insert(schema.DataConnector)
    .values({
      organizationId: org.id,
      type: 'app:shopify',
      definitionKind: 'app',
      name: 'Shopify',
      createdById: user.id,
    })
    .returning()
  const [stream] = await db()
    .insert(schema.DataConnectorStream)
    .values({ dataConnectorId: connector!.id, organizationId: org.id, streamKey: 'order' })
    .returning()
  const bind = (attr: string): FieldMapping => ({
    id: `fm_${attr}`,
    targetFieldRef: ref(attr),
    expression: `{${attr}}`,
    sourceFields: { [attr]: attr },
  })
  const [row] = await db()
    .insert(schema.DataConnectorMapping)
    .values({
      dataConnectorStreamId: stream!.id,
      organizationId: org.id,
      targetMode: 'contributing',
      entityDefinitionId: defId,
      fieldMappings: [
        bind('order_currency'),
        bind('order_note'),
        bind('order_cancelled_at'),
        bind('order_shipping_address'),
      ],
    })
    .returning()
  return {
    orgId: org.id,
    userId: user.id,
    defId,
    connector: connector!,
    mapping: decodeMapping(row!),
    fieldId,
    ref,
  }
}

/** A sink context shaped like `connector-sync-source`'s `buildCtx`, on a real run. */
async function buildCtx(f: Fixture): Promise<SyncCtx> {
  const run = await openRun(db(), {
    dataConnectorId: f.connector.id,
    organizationId: f.orgId,
    trigger: 'manual',
    mode: 'snapshot',
    phase: 'backfill',
  })
  const manifest = await loadManifestCollector(f.orgId)
  const session: WriteSession = {
    origin: { kind: 'sync', source: 'connector', ref: run.id, collector: manifest },
    depth: 0,
  }
  const crud = new UnifiedCrudHandler(f.orgId, f.userId, db(), undefined, { session })
  await crud.warmCache(f.defId)
  return {
    db: db(),
    orgId: f.orgId,
    connector: f.connector,
    runId: run.id,
    userId: f.userId,
    crud,
    ownedCrud: crud,
    counters: newRunCounters(),
    failureTally: newRecordFailureTally(),
    manifest,
    touchedDefs: new Set<string>(),
    sweep: false,
    connectionMeta: null,
  }
}

const ADDRESS = { street1: '1 Main St', city: 'New York', zipCode: '10001', country: 'US' }

function order(f: Fixture, over: Record<string, unknown> = {}): ProjectedRecord {
  return {
    externalId: 'o1',
    displayName: '#o1',
    fields: {
      [f.ref('order_currency')]: 'USD',
      [f.ref('order_note')]: null,
      [f.ref('order_cancelled_at')]: null,
      [f.ref('order_shipping_address')]: ADDRESS,
      ...over,
    },
    identityCandidates: [],
    pendingRelations: [],
  }
}

async function sync(f: Fixture, record: ProjectedRecord): Promise<SyncCtx> {
  const ctx = await buildCtx(f)
  await entitySink.upsertRecord(ctx, f.mapping, record)
  expect(ctx.counters.errorSample).toEqual([])
  return ctx
}

async function item(f: Fixture) {
  const [row] = await db()
    .select()
    .from(schema.DataConnectorItem)
    .where(eq(schema.DataConnectorItem.dataConnectorId, f.connector.id))
  return row!
}

async function cell(f: Fixture, instanceId: string, attr: string) {
  const [row] = await db()
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.entityId, instanceId),
        eq(schema.FieldValue.fieldId, f.fieldId(attr))
      )
    )
  return row ?? null
}

describe('entitySink managedFields against the real write path', () => {
  it('a blank upstream value is not managed, and the unchanged record skips on the second sync', async () => {
    const f = await seed()
    const first = await sync(f, order(f))
    expect(first.counters.created).toBe(1)

    const bound = await item(f)
    expect(bound.managedFields).toContain(f.ref('order_currency'))
    expect(bound.managedFields).not.toContain(f.ref('order_note'))
    expect(bound.managedFields).not.toContain(f.ref('order_cancelled_at'))

    const second = await sync(f, order(f))
    expect(second.counters.updated).toBe(0)
    expect(second.counters.skipped).toBe(1)
  })

  it('a value the connector clears upstream is cleared and leaves managedFields', async () => {
    const f = await seed()
    await sync(f, order(f, { [f.ref('order_note')]: 'gift wrap' }))
    const instanceId = (await item(f)).entityInstanceId!
    expect((await item(f)).managedFields).toContain(f.ref('order_note'))
    expect(await cell(f, instanceId, 'order_note')).not.toBeNull()

    const cleared = await sync(f, order(f))
    expect(cleared.counters.updated).toBe(1)
    expect(await cell(f, instanceId, 'order_note')).toBeNull()
    expect((await item(f)).managedFields).not.toContain(f.ref('order_note'))

    const again = await sync(f, order(f))
    expect(again.counters.skipped).toBe(1)
  })

  it('a managed cell the user clears still heals on the next sync', async () => {
    const f = await seed()
    await sync(f, order(f, { [f.ref('order_note')]: 'gift wrap' }))
    const instanceId = (await item(f)).entityInstanceId!
    await db()
      .delete(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.entityId, instanceId),
          eq(schema.FieldValue.fieldId, f.fieldId('order_note'))
        )
      )

    const healed = await sync(f, order(f, { [f.ref('order_note')]: 'gift wrap' }))
    expect(healed.counters.updated).toBe(1)
    const note = await cell(f, instanceId, 'order_note')
    expect(note?.valueText).toBe('gift wrap')
    expect(note?.managedByConnectorId).toBe(f.connector.id)
  })

  it('an ADDRESS_STRUCT write stays stamped through the geocode write-back and skips next sync', async () => {
    const f = await seed()
    await sync(f, order(f))
    const instanceId = (await item(f)).entityInstanceId!
    expect((await cell(f, instanceId, 'order_shipping_address'))?.managedByConnectorId).toBe(
      f.connector.id
    )

    // What the finalize-time ADDRESS_STRUCT batch does for each synced address.
    const [field] = await db()
      .select()
      .from(schema.CustomField)
      .where(eq(schema.CustomField.id, f.fieldId('order_shipping_address')))
    await runNormalize(
      {
        organizationId: f.orgId,
        userId: f.userId,
        recordId: toRecordId(f.defId, instanceId),
        entityDefinitionId: f.defId,
        field: field as unknown as CachedField,
      } as never,
      // A copy: `mergeAddress` writes lat/lng onto the struct it is handed.
      { ...ADDRESS }
    )

    const address = await cell(f, instanceId, 'order_shipping_address')
    expect((address?.valueJson as { v?: { lat?: number } } | null)?.v?.lat).toBe(40.7)
    expect(address?.managedByConnectorId).toBe(f.connector.id)

    const second = await sync(f, order(f))
    expect(second.counters.updated).toBe(0)
    expect(second.counters.skipped).toBe(1)
  })
})
