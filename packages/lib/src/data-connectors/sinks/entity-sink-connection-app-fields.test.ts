// packages/lib/src/data-connectors/sinks/entity-sink-connection-app-fields.test.ts
// connectionAppFields (identity plan phase 3): a `connectionMetaKey`-flagged
// FieldMapping reads its value from `ctx.connectionMeta`, not the source record —
// injected before the normal write-set build so every existing merge-strategy /
// provenance / ref-resolution path applies unchanged.
// plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md Phase 3.

import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord, SyncCtx } from './types'

const findItem = vi.fn()
const findItemByDef = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
vi.mock('../service', () => ({
  findItem: (...a: unknown[]) => findItem(...a),
  findItemByDef: (...a: unknown[]) => findItemByDef(...a),
  touchItem: (...a: unknown[]) => touchItem(...a),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
  listItemsForMapping: vi.fn(),
  markItemArchived: vi.fn(),
  setItemPendingRelations: vi.fn(),
}))

const resolveConnectorFieldRef = vi.fn()
vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: (...a: unknown[]) => resolveConnectorFieldRef(...a),
}))
const buildWriteKeyToFieldId = vi.fn()
vi.mock('../field-id-resolver', () => ({
  buildWriteKeyToFieldId: (...a: unknown[]) => buildWriteKeyToFieldId(...a),
}))

const getCachedFieldMap = vi.fn()
vi.mock('../../cache', () => ({ getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a) }))

const upsertRecordIdentity = vi.fn()
vi.mock('../../identity', () => ({
  upsertRecordIdentity: (...a: unknown[]) => upsertRecordIdentity(...a),
}))

import { entitySink } from './entity-sink'

const FIELD_ID = 'field_storeDomain'
const RAW_REF = 'contact:@app:shopify:storeDomain'
const DEF_ID = 'def_contact'

function mapping(over: Partial<DecodedMapping> = {}): DecodedMapping {
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: DEF_ID,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: [
      {
        id: 'fm1',
        targetFieldRef: RAW_REF,
        expression: '',
        sourceFields: {},
        connectionMetaKey: 'shopDomain',
      },
    ],
    ...over,
  } as unknown as DecodedMapping
}

function record(over: Partial<ProjectedRecord> = {}): ProjectedRecord {
  return {
    externalId: 'c1',
    displayName: 'Jane',
    fields: {},
    identityCandidates: [],
    pendingRelations: [],
    ...over,
  }
}

const create = vi.fn()
const update = vi.fn().mockResolvedValue(undefined)
const getFieldValues = vi.fn()

/** Chainable `db.update(...).set(...).where(...)` stub for stampContributingProvenance. */
function makeDb() {
  return {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  }
}

function makeCtx(over: Partial<SyncCtx> = {}): SyncCtx {
  return {
    db: makeDb() as never,
    orgId: 'org1',
    connector: { id: 'dc1', credentialId: 'cred1' } as SyncCtx['connector'],
    runId: 'run1',
    crud: { update, create, getFieldValues } as never,
    ownedCrud: { update, create, getFieldValues } as never,
    counters: {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      failed: 0,
      relationshipWarnings: 0,
      errorSample: [],
    } as SyncCtx['counters'],
    touchedDefs: new Set<string>(),
    connectionMeta: { shopDomain: 'us.myshopify.com' },
    ...over,
  }
}

beforeEach(() => {
  findItem.mockReset()
  findItem.mockResolvedValue(null)
  findItemByDef.mockReset()
  findItemByDef.mockResolvedValue(null)
  touchItem.mockReset()
  upsertItem.mockReset()
  update.mockClear()
  create.mockReset()
  create.mockResolvedValue({ instance: { id: 'inst1' } })
  getFieldValues.mockReset()
  resolveConnectorFieldRef.mockReset()
  resolveConnectorFieldRef.mockImplementation(async (ref: string) =>
    ref === RAW_REF ? toResourceFieldId(DEF_ID, FIELD_ID) : null
  )
  buildWriteKeyToFieldId.mockReset()
  buildWriteKeyToFieldId.mockResolvedValue(new Map([[FIELD_ID, FIELD_ID]]))
  getCachedFieldMap.mockReset()
  getCachedFieldMap.mockResolvedValue(new Map())
  upsertRecordIdentity.mockReset()
  upsertRecordIdentity.mockResolvedValue({ ok: true, value: { id: 'ri1' } })
})

describe('entitySink connectionAppFields injection', () => {
  it('writes the connection-metadata value onto the resolved field, on create', async () => {
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1]).toMatchObject({ [FIELD_ID]: 'us.myshopify.com' })
  })

  it('re-asserts the value on update (plain attribute — normal overwrite, not fill-blank)', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      contentHash: 'stale',
      pendingRelations: [],
    })
    getFieldValues.mockResolvedValue(new Map())
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ [FIELD_ID]: 'us.myshopify.com' })
  })

  it('omits the key entirely when connectionMeta has no value for it (never writes null)', async () => {
    const ctx = makeCtx({ connectionMeta: {} })

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty(FIELD_ID)
  })

  it('omits the key entirely when the connector has no bound connection (connectionMeta null)', async () => {
    const ctx = makeCtx({ connectionMeta: null })

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty(FIELD_ID)
  })

  it('does not mirror a connectionMetaKey field into RecordIdentity (no identityRole)', async () => {
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(upsertRecordIdentity).not.toHaveBeenCalled()
  })
})
