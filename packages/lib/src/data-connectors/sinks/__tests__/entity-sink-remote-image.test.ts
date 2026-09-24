// packages/lib/src/data-connectors/sinks/__tests__/entity-sink-remote-image.test.ts
// Image URLs on FILE fields (plans/remote-image-ingest/03-connector.md §5): diverted
// out of the write set to a background fetch, never written as a clearing null.

import { toResourceFieldId } from '@auxx/types/field'
import { stableHash } from '@auxx/utils/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../../__test-helpers'
import type { DecodedMapping } from '../../service'
import type { FieldMergeStrategy } from '../../types'
import type { ProjectedRecord, SyncCtx } from '../types'

const findItem = vi.fn()
const findItemByDef = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
vi.mock('../../service', () => ({
  findItem: (...a: unknown[]) => findItem(...a),
  findItemByDef: (...a: unknown[]) => findItemByDef(...a),
  touchItem: (...a: unknown[]) => touchItem(...a),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
  listItemsForMapping: vi.fn(),
  markItemArchived: vi.fn(),
  setItemPendingRelations: vi.fn(),
}))

const resolveConnectorFieldRef = vi.fn()
vi.mock('../../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: (...a: unknown[]) => resolveConnectorFieldRef(...a),
}))
const buildWriteKeyToFieldId = vi.fn()
vi.mock('../../field-id-resolver', () => ({
  buildWriteKeyToFieldId: (...a: unknown[]) => buildWriteKeyToFieldId(...a),
}))

const getCachedFieldMap = vi.fn()
vi.mock('../../../cache', () => ({
  getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a),
  getCachedResource: vi.fn(async () => null),
}))

vi.mock('../../../identity', () => ({ upsertRecordIdentity: vi.fn() }))

const enqueueRecordImageFetch = vi.fn()
vi.mock('../../../files/remote-image/enqueue', () => ({
  enqueueRecordImageFetch: (...a: unknown[]) => enqueueRecordImageFetch(...a),
}))

import { entitySink } from '../entity-sink'

const DEF_ID = 'def_product'
const NAME_KEY = 'product_name'
const NAME_UUID = 'field-name-uuid'
const NAME_REF = toResourceFieldId(DEF_ID, NAME_KEY)
const IMAGE_KEY = 'product_image'
const IMAGE_UUID = 'field-image-uuid'
const IMAGE_REF = toResourceFieldId(DEF_ID, IMAGE_KEY)
const URL = 'https://cdn.shopify.com/p/1.jpg?v=2'

function mapping(imageStrategy?: FieldMergeStrategy, onlyImage = false): DecodedMapping {
  const image = {
    id: 'fm2',
    targetFieldRef: IMAGE_REF,
    expression: '{i}',
    sourceFields: {},
    ...(imageStrategy ? { mergeStrategy: imageStrategy } : {}),
  }
  const name = { id: 'fm1', targetFieldRef: NAME_REF, expression: '{n}', sourceFields: {} }
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: DEF_ID,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: onlyImage ? [image] : [name, image],
  } as unknown as DecodedMapping
}

function record(fields: Record<string, unknown>): ProjectedRecord {
  return {
    externalId: 'p1',
    displayName: 'Mug',
    fields,
    identityCandidates: [],
    pendingRelations: [],
  }
}

function makeDb() {
  return {
    query: { DataConnectorItem: { findFirst: vi.fn(async () => null) } },
    select: vi.fn(),
    execute: vi.fn(async () => ({ rows: [] })),
    update: vi.fn(() => ({ set: () => ({ where: async () => {} }) })),
  }
}

const create = vi.fn()
const update = vi.fn()
const getFieldValues = vi.fn()

function makeCtx(db = makeDb()): SyncCtx {
  return makeSyncCtx({
    db: db as never,
    crud: { update, create, getFieldValues } as never,
    ownedCrud: { update, create, getFieldValues } as never,
  })
}

function boundItem(over: Record<string, unknown> = {}) {
  return {
    id: 'item1',
    entityInstanceId: 'inst1',
    contentHash: 'stale',
    pendingRelations: [],
    managedFields: [NAME_REF, IMAGE_REF],
    pinnedFields: [],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findItem.mockResolvedValue(null)
  findItemByDef.mockResolvedValue(null)
  update.mockResolvedValue(undefined)
  create.mockResolvedValue({ instance: { id: 'created1' } })
  getFieldValues.mockResolvedValue(new Map())
  enqueueRecordImageFetch.mockResolvedValue(true)
  resolveConnectorFieldRef.mockImplementation(async (ref: string) => ref)
  buildWriteKeyToFieldId.mockResolvedValue(
    new Map([
      [NAME_KEY, NAME_UUID],
      [IMAGE_KEY, IMAGE_UUID],
    ])
  )
  getCachedFieldMap.mockResolvedValue(
    new Map([
      [NAME_UUID, { id: NAME_UUID, type: 'TEXT', options: {} }],
      [IMAGE_UUID, { id: IMAGE_UUID, type: 'FILE', options: {} }],
    ])
  )
})

describe('entitySink: image URL on a FILE field', () => {
  it('keeps the URL out of the write set and enqueues one fetch after the write', async () => {
    findItem.mockResolvedValue(boundItem())
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ [NAME_REF]: 'Mug', [IMAGE_REF]: URL }))

    expect(update.mock.calls[0]?.[1]).toEqual({ [NAME_KEY]: 'Mug' })
    expect(enqueueRecordImageFetch).toHaveBeenCalledTimes(1)
    expect(enqueueRecordImageFetch).toHaveBeenCalledWith({
      organizationId: 'org1',
      entityDefinitionId: DEF_ID,
      instanceId: 'inst1',
      fieldId: IMAGE_UUID,
      url: URL,
      connectorId: 'dc1',
    })
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueRecordImageFetch.mock.invocationCallOrder[0]!
    )
  })

  it('an existing image survives a re-sync where the record changed (the clearing bug)', async () => {
    findItem.mockResolvedValue(boundItem())
    const ctx = makeCtx()

    await entitySink.upsertRecord(
      ctx,
      mapping(),
      record({ [NAME_REF]: 'Renamed mug', [IMAGE_REF]: URL })
    )

    // Nothing reaches the image cell on the record write: no null, no string.
    const payload = update.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).not.toHaveProperty(IMAGE_KEY)
    expect(payload).not.toHaveProperty(IMAGE_UUID)
    expect(ctx.counters.failed).toBe(0)
  })

  it('enqueues against the freshly created instance', async () => {
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ [NAME_REF]: 'Mug', [IMAGE_REF]: URL }))

    expect(create.mock.calls[0]?.[1]).toEqual({ [NAME_KEY]: 'Mug' })
    expect(enqueueRecordImageFetch).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'created1', fieldId: IMAGE_UUID, url: URL })
    )
  })

  it('a { ref } value is written as today and not enqueued', async () => {
    findItem.mockResolvedValue(boundItem())
    const ctx = makeCtx()
    const value = { ref: 'asset:abc' }

    await entitySink.upsertRecord(ctx, mapping(), record({ [IMAGE_REF]: value }))

    expect(update.mock.calls[0]?.[1]).toEqual({ [IMAGE_KEY]: value })
    expect(enqueueRecordImageFetch).not.toHaveBeenCalled()
  })

  it.each([
    [''],
    ['   '],
    [null],
  ])('a blank value (%j) is neither written nor cleared', async (blank) => {
    findItem.mockResolvedValue(boundItem())
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ [NAME_REF]: 'Mug', [IMAGE_REF]: blank }))

    expect(update.mock.calls[0]?.[1]).toEqual({ [NAME_KEY]: 'Mug' })
    expect(enqueueRecordImageFetch).not.toHaveBeenCalled()
  })

  it('fill_blank leaves an existing image alone', async () => {
    findItem.mockResolvedValue(boundItem())
    getFieldValues.mockResolvedValue(
      new Map([[IMAGE_UUID, { type: 'json', value: { ref: 'asset:old' } }]])
    )
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping('fill_blank'), record({ [IMAGE_REF]: URL }))

    expect(enqueueRecordImageFetch).not.toHaveBeenCalled()
  })

  it('a failed record write enqueues nothing', async () => {
    findItem.mockResolvedValue(boundItem())
    update.mockRejectedValue(new Error('boom'))
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ [NAME_REF]: 'Mug', [IMAGE_REF]: URL }))

    expect(ctx.counters.failed).toBe(1)
    expect(enqueueRecordImageFetch).not.toHaveBeenCalled()
  })
})

describe('entitySink: FILE fields are not drift-healed', () => {
  it('an unchanged record whose only overwrite binding is FILE skips without a drift query', async () => {
    const rec = record({ [IMAGE_REF]: URL })
    findItem.mockResolvedValue(
      boundItem({ contentHash: stableHash({ fields: rec.fields, displayName: rec.displayName }) })
    )
    const db = makeDb()
    const ctx = makeCtx(db)

    await entitySink.upsertRecord(ctx, mapping(undefined, true), rec)

    expect(db.execute).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
  })
})
