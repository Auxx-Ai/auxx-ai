// packages/lib/src/data-connectors/sinks/entity-sink-pin.test.ts
// Per-field sync pin at the sink (plans/money/tasks/40 section 6.1): a field the
// user paused on a record (`DataConnectorItem.pinnedFields`, concrete
// `CustomField` ids) reaches neither the scalar write set nor the row-level
// write list, whatever the binding's merge strategy, so it is never written and
// never stamped. It stays in `managedFields`, so the read side can show `paused`.
// Mock recipe copied from entity-sink-row-level.test.ts next door.

import { toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
import type { DecodedMapping } from '../service'
import type { FieldMergeStrategy } from '../types'
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
const getCachedResource = vi.fn()
vi.mock('../../cache', () => ({
  getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a),
  getCachedResource: (...a: unknown[]) => getCachedResource(...a),
}))

vi.mock('../../identity', () => ({ upsertRecordIdentity: vi.fn() }))

vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: vi.fn(() => ({})),
  validateAndConvertValue: vi.fn(async (_ctx: unknown, value: unknown) => ({
    type: 'text',
    value: String(value).trim().toLowerCase(),
  })),
  maybeUpdateDisplayValue: vi.fn(),
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  // The planner reads the value column off the built row to compare and to write.
  buildFieldValueRow: (params: { value: { value: string } } & Record<string, unknown>) => ({
    ...params,
    valueText: params.value.value,
  }),
}))
vi.mock('../../field-values/search-text', () => ({ updateSearchText: vi.fn() }))
vi.mock('../../custom-fields/check-unique-value-typed', () => ({
  checkUniqueValueTyped: vi.fn(async () => true),
}))

import { entitySink } from './entity-sink'

const DEF_ID = 'def_contact'

// A system field: the write key is its systemAttribute, the pin is its uuid.
const FIRST_KEY = 'first_name'
const FIRST_UUID = 'field-first-uuid'
const FIRST_REF = toResourceFieldId(DEF_ID, FIRST_KEY)
// A custom field: the write key already IS the uuid.
const NOTES_UUID = 'field-notes-uuid'
const NOTES_REF = toResourceFieldId(DEF_ID, NOTES_UUID)
// A multi-value field, diverted to the row-level path on an existing instance.
const EMAIL_KEY = 'primary_email'
const EMAIL_UUID = 'field-email-uuid'
const EMAIL_REF = toResourceFieldId(DEF_ID, EMAIL_KEY)

function fieldRow(id: string, systemAttribute: string | null, over: Record<string, unknown> = {}) {
  return {
    id,
    type: 'TEXT',
    modelType: 'contact',
    systemAttribute,
    options: {},
    isUnique: false,
    ...over,
  }
}

function mapping(strategy?: FieldMergeStrategy): DecodedMapping {
  const withStrategy = strategy ? { mergeStrategy: strategy } : {}
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
        targetFieldRef: FIRST_REF,
        expression: '{f}',
        sourceFields: {},
        ...withStrategy,
      },
      {
        id: 'fm2',
        targetFieldRef: NOTES_REF,
        expression: '{n}',
        sourceFields: {},
        ...withStrategy,
      },
      {
        id: 'fm3',
        targetFieldRef: EMAIL_REF,
        expression: '{e}',
        sourceFields: {},
        ...withStrategy,
      },
    ],
  } as unknown as DecodedMapping
}

function record(fields: Record<string, unknown>): ProjectedRecord {
  return {
    externalId: 'c1',
    displayName: 'Jane',
    fields,
    identityCandidates: [],
    pendingRelations: [],
  }
}

/** Chainable db stub: FieldValue row reads + every `update().set()` payload. */
function makeDb(rows: Array<Record<string, unknown>> = []) {
  const updateCalls: Array<Record<string, unknown>> = []
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ orderBy: async () => rows }) }),
  }))
  const db = {
    query: { DataConnectorItem: { findFirst: vi.fn(async () => null) } },
    select,
    selectDistinct: vi.fn(),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(vals)
        },
      }),
    })),
  }
  return { db, updateCalls, select }
}

const create = vi.fn()
const update = vi.fn()
const getFieldValues = vi.fn()

function makeCtx(over: Partial<SyncCtx> = {}): SyncCtx {
  return makeSyncCtx({
    crud: { update, create, getFieldValues } as never,
    ownedCrud: { update, create, getFieldValues } as never,
    ...over,
  })
}

function boundItem(pinnedFields: string[], over: Record<string, unknown> = {}) {
  return {
    id: 'item1',
    entityInstanceId: 'inst1',
    contentHash: 'stale',
    pendingRelations: [],
    managedFields: [FIRST_REF, NOTES_REF, EMAIL_REF],
    pinnedFields,
    ...over,
  }
}

/** The write-key maps handed out, in call order, each with a spied `get`. */
let keyMaps: Array<Map<string, string>> = []

beforeEach(() => {
  vi.clearAllMocks()
  findItem.mockResolvedValue(null)
  findItemByDef.mockResolvedValue(null)
  update.mockResolvedValue(undefined)
  create.mockResolvedValue({ instance: { id: 'created1' } })
  getFieldValues.mockResolvedValue(new Map())
  resolveConnectorFieldRef.mockImplementation(async (ref: string) => ref)
  keyMaps = []
  buildWriteKeyToFieldId.mockImplementation(async () => {
    const m = new Map([
      [FIRST_KEY, FIRST_UUID],
      [FIRST_UUID, FIRST_UUID],
      [NOTES_UUID, NOTES_UUID],
      [EMAIL_KEY, EMAIL_UUID],
      [EMAIL_UUID, EMAIL_UUID],
    ])
    vi.spyOn(m, 'get')
    keyMaps.push(m)
    return m
  })
  getCachedFieldMap.mockResolvedValue(
    new Map([
      [FIRST_UUID, fieldRow(FIRST_UUID, FIRST_KEY)],
      [NOTES_UUID, fieldRow(NOTES_UUID, null)],
      [EMAIL_UUID, fieldRow(EMAIL_UUID, EMAIL_KEY, { type: 'EMAIL', options: { multi: true } })],
    ])
  )
  getCachedResource.mockResolvedValue(null)
})

describe('entitySink: a pinned field is dropped from the scalar write set', () => {
  it.each<[FieldMergeStrategy | undefined]>([
    [undefined],
    ['overwrite'],
    ['fill_blank'],
    ['connector_owned_only'],
  ])('under strategy %s, the pinned system field is skipped and the other field still writes', async (strategy) => {
    findItem.mockResolvedValue(boundItem([FIRST_UUID]))
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(
      ctx,
      mapping(strategy),
      record({ [FIRST_REF]: 'Jane', [NOTES_REF]: 'hello' })
    )

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({ [NOTES_UUID]: 'hello' })
    expect(ctx.counters.failed).toBe(0)
  })

  it('pins a custom field whose write key already is the uuid', async () => {
    findItem.mockResolvedValue(boundItem([NOTES_UUID]))
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [FIRST_REF]: 'Jane', [NOTES_REF]: 'x' }))

    expect(update.mock.calls[0]?.[1]).toEqual({ [FIRST_KEY]: 'Jane' })
  })

  it('an unpinned record writes both fields (the control)', async () => {
    findItem.mockResolvedValue(boundItem([]))
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [FIRST_REF]: 'Jane', [NOTES_REF]: 'x' }))

    expect(update.mock.calls[0]?.[1]).toEqual({ [FIRST_KEY]: 'Jane', [NOTES_UUID]: 'x' })
  })
})

describe('entitySink: a pinned multi field reaches no row write', () => {
  it('plans nothing and stamps nothing for the pinned field', async () => {
    findItem.mockResolvedValue(boundItem([EMAIL_UUID]))
    const { db, updateCalls, select } = makeDb([
      { id: 'r1', sortKey: 'a0', valueText: 'old@x.com', managedByConnectorId: 'dc1' },
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [EMAIL_REF]: 'new@x.com' }))

    // The scalar write still happens (empty), but no row plan was read or written.
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({})
    expect(select).not.toHaveBeenCalled()
    expect(updateCalls).toHaveLength(0)
  })

  it('the same multi field still writes its row when it is not pinned (the control)', async () => {
    findItem.mockResolvedValue(boundItem([]))
    const { db, updateCalls } = makeDb([
      { id: 'r1', sortKey: 'a0', valueText: 'old@x.com', managedByConnectorId: 'dc1' },
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [EMAIL_REF]: 'new@x.com' }))

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toMatchObject({ valueText: 'new@x.com', managedByConnectorId: 'dc1' })
  })
})

describe('entitySink: a pinned field is not stamped', () => {
  it('does not touch FieldValue at all when the only sourced field is pinned', async () => {
    findItem.mockResolvedValue(boundItem([FIRST_UUID]))
    const { db, updateCalls } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [FIRST_REF]: 'Jane' }))

    expect(update.mock.calls[0]?.[1]).toEqual({})
    expect(updateCalls).toHaveLength(0)
  })

  it('stamps only the written field when a pinned one sits beside it', async () => {
    findItem.mockResolvedValue(boundItem([FIRST_UUID]))
    const { db, updateCalls } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [FIRST_REF]: 'Jane', [NOTES_REF]: 'x' }))

    // One marker UPDATE ran, and the write-key map the stamp resolved through was
    // asked for the written key only. The first map is buildWriteSet's own.
    expect(updateCalls).toEqual([{ managedByConnectorId: 'dc1' }])
    expect(keyMaps).toHaveLength(2)
    const stampLookups = vi.mocked(keyMaps[1]!.get).mock.calls.map((c) => c[0])
    expect(stampLookups).toEqual([NOTES_UUID])
  })
})

describe('entitySink: a pinned field stays managed', () => {
  it('keeps the pinned ref in the binding managedFields', async () => {
    findItem.mockResolvedValue(boundItem([FIRST_UUID], { managedFields: [] }))
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record({ [FIRST_REF]: 'Jane', [NOTES_REF]: 'x' }))

    expect(upsertItem).toHaveBeenCalledTimes(1)
    expect(upsertItem.mock.calls[0]?.[1]).toMatchObject({
      managedFields: expect.arrayContaining([FIRST_REF, NOTES_REF]),
    })
  })
})
