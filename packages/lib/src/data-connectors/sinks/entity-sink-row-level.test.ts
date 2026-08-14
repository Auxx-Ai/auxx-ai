// packages/lib/src/data-connectors/sinks/entity-sink-row-level.test.ts
// B1 row-level semantics for multi-value (`options.multi`) target fields + the
// B6 sink test slice: own-row in-place update (alias + primary intact), never
// re-stamp a user-owned value, fill_blank only on an empty list, source null
// never clears the list, drifted-forever regression (alias must not defeat the
// content-hash skip), per-value uniqueness conflicts keep the sync green, an
// array-shaped match candidate FAILS the record instead of creating a silent
// duplicate, and in-slice two-source dedupe (first wins field writes, the
// second still binds).

import { toResourceFieldId } from '@auxx/types/field'
import { stableHash } from '@auxx/utils/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
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
const getCachedResource = vi.fn()
vi.mock('../../cache', () => ({
  getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a),
  getCachedResource: (...a: unknown[]) => getCachedResource(...a),
}))

vi.mock('../../identity', () => ({ upsertRecordIdentity: vi.fn() }))

// Lazy-imported field-value helpers (row-level path only) — tiny stand-ins so the
// real field-values graph never loads under the test collector.
const maybeUpdateDisplayValue = vi.fn()
const updateSearchText = vi.fn()
vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: vi.fn(() => ({})),
  validateAndConvertValue: vi.fn(async (_ctx: unknown, value: unknown) => ({
    type: 'text',
    value: String(value).trim().toLowerCase(),
  })),
  maybeUpdateDisplayValue: (...a: unknown[]) => maybeUpdateDisplayValue(...a),
}))
vi.mock('../../field-values/field-value-mutations', () => ({
  buildFieldValueRow: (params: {
    organizationId: string
    entityId: string
    entityDefinitionId: string
    fieldId: string
    value: { value: string }
    sortKey: string
  }) => ({
    organizationId: params.organizationId,
    entityId: params.entityId,
    entityDefinitionId: params.entityDefinitionId,
    fieldId: params.fieldId,
    sortKey: params.sortKey,
    valueText: params.value.value,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
  }),
}))
vi.mock('../../field-values/search-text', () => ({
  updateSearchText: (...a: unknown[]) => updateSearchText(...a),
}))
const checkUniqueValueTyped = vi.fn()
vi.mock('../../custom-fields/check-unique-value-typed', () => ({
  checkUniqueValueTyped: (...a: unknown[]) => checkUniqueValueTyped(...a),
}))

import { UniqueValueConflictError } from '../../errors'
import { entitySink } from './entity-sink'

const DEF_ID = 'def_contact'
const EMAIL_KEY = 'primary_email'
const EMAIL_UUID = 'field-email-uuid'
const EMAIL_REF = toResourceFieldId(DEF_ID, EMAIL_KEY)

function emailField(over: Record<string, unknown> = {}) {
  return {
    id: EMAIL_UUID,
    type: 'EMAIL',
    modelType: 'contact',
    systemAttribute: EMAIL_KEY,
    options: { multi: true },
    isUnique: false,
    ...over,
  }
}

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
        targetFieldRef: EMAIL_REF,
        expression: '{email}',
        sourceFields: { email: 'email' },
        identityRole: { kind: 'match', normalize: 'email' },
      },
    ],
    ...over,
  } as unknown as DecodedMapping
}

function record(email: unknown, over: Partial<ProjectedRecord> = {}): ProjectedRecord {
  return {
    externalId: 'c1',
    displayName: 'Jane',
    fields: { [EMAIL_REF]: email },
    identityCandidates: [{ targetFieldRef: EMAIL_REF, value: email, normalize: 'email' }],
    pendingRelations: [],
    ...over,
  }
}

interface FvRow {
  id: string
  sortKey: string
  valueText: string
  managedByConnectorId: string | null
}
function row(id: string, sortKey: string, valueText: string, marker: string | null): FvRow {
  return { id, sortKey, valueText, managedByConnectorId: marker }
}

/** Chainable db stub: FieldValue row reads + recorded `update().set()` calls. */
function makeDb(rows: FvRow[] = []) {
  const updateCalls: Array<Record<string, unknown>> = []
  const selectDistinct = vi.fn()
  const db = {
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ orderBy: async () => rows }) }),
    })),
    selectDistinct,
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(vals)
        },
      }),
    })),
  }
  return { db, updateCalls, selectDistinct }
}

const create = vi.fn()
const update = vi.fn().mockResolvedValue(undefined)
const getFieldValues = vi.fn()
const lookupByField = vi.fn()

function makeCtx(over: Partial<SyncCtx> = {}): SyncCtx {
  return makeSyncCtx({
    crud: { update, create, getFieldValues, lookupByField } as never,
    ownedCrud: { update, create, getFieldValues, lookupByField } as never,
    ...over,
  })
}

/** The bound item every "existing instance" test starts from. */
function boundItem(over: Record<string, unknown> = {}) {
  return {
    id: 'item1',
    entityInstanceId: 'inst1',
    contentHash: 'stale',
    pendingRelations: [],
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
  update.mockReset()
  update.mockResolvedValue(undefined)
  create.mockReset()
  create.mockResolvedValue({ instance: { id: 'created1' } })
  getFieldValues.mockReset()
  getFieldValues.mockResolvedValue(new Map())
  lookupByField.mockReset()
  lookupByField.mockResolvedValue({ items: [], hasMore: false })
  resolveConnectorFieldRef.mockReset()
  resolveConnectorFieldRef.mockImplementation(async (ref: string) =>
    ref === EMAIL_REF ? EMAIL_REF : null
  )
  buildWriteKeyToFieldId.mockReset()
  buildWriteKeyToFieldId.mockResolvedValue(
    new Map([
      [EMAIL_KEY, EMAIL_UUID],
      [EMAIL_UUID, EMAIL_UUID],
    ])
  )
  getCachedFieldMap.mockReset()
  getCachedFieldMap.mockResolvedValue(new Map([[EMAIL_UUID, emailField()]]))
  getCachedResource.mockReset()
  getCachedResource.mockResolvedValue(null)
  maybeUpdateDisplayValue.mockReset()
  updateSearchText.mockReset()
  checkUniqueValueTyped.mockReset()
  checkUniqueValueTyped.mockResolvedValue(true)
})

describe('entitySink row-level multi-field writes (B1)', () => {
  it('resync with a changed source email updates the connector row IN PLACE — alias + primary untouched', async () => {
    findItem.mockResolvedValue(boundItem())
    // Connector's row is primary; user alias sits behind it.
    const { db, updateCalls } = makeDb([
      row('r1', 'a0', 'old@x.com', 'dc1'),
      row('r2', 'a1', 'alias@x.com', null),
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('new@x.com'))

    // No whole-field set: the scalar write set stays empty…
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({})
    // …and the connector's own row is updated in place (sortKey untouched).
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toMatchObject({
      valueText: 'new@x.com',
      managedByConnectorId: 'dc1',
    })
    expect(updateCalls[0]!.sortKey).toBeUndefined()
    // Primary row changed → display columns follow.
    expect(maybeUpdateDisplayValue).toHaveBeenCalledTimes(1)
    expect(ctx.counters.failed).toBe(0)
    expect(upsertItem).toHaveBeenCalledTimes(1)
  })

  it('updating a NON-primary own row refreshes search text, not the display columns', async () => {
    findItem.mockResolvedValue(boundItem())
    const { db, updateCalls } = makeDb([
      row('r1', 'a0', 'primary@x.com', null),
      row('r2', 'a1', 'old@x.com', 'dc1'),
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('new@x.com'))

    expect(updateCalls[0]).toMatchObject({ valueText: 'new@x.com' })
    expect(maybeUpdateDisplayValue).not.toHaveBeenCalled()
    expect(updateSearchText).toHaveBeenCalledTimes(1)
  })

  it('never re-stamps a user-owned value: incoming value already present on an unmarked row → no write', async () => {
    findItem.mockResolvedValue(boundItem())
    const { db, updateCalls } = makeDb([
      row('r1', 'a0', 'primary@x.com', null),
      row('r2', 'a1', 'alias@x.com', null),
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('Alias@X.com')) // case-insensitive match

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({})
    expect(updateCalls).toHaveLength(0) // no row update, no stamp
  })

  it('appends at the end when the value is new and no connector row exists, stamping ONLY the new row', async () => {
    findItem.mockResolvedValue(boundItem())
    const { db, updateCalls } = makeDb([row('r1', 'a0', 'primary@x.com', null)])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('new@x.com'))

    // Append rides the `add` multi-value primitive, never a whole-field set.
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1]?.[1]).toEqual({ [EMAIL_KEY]: ['new@x.com'] })
    expect(update.mock.calls[1]?.[2]).toEqual({ [EMAIL_KEY]: 'add' })
    // The stamp UPDATE touches only the marker.
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]).toEqual({ managedByConnectorId: 'dc1' })
  })

  it('fill_blank writes only when the list is empty', async () => {
    const fillBlank = () =>
      mapping({
        fieldMappings: [
          {
            id: 'fm1',
            targetFieldRef: EMAIL_REF,
            expression: '{email}',
            sourceFields: { email: 'email' },
            mergeStrategy: 'fill_blank',
          },
        ],
      } as never)

    // Non-empty list → nothing happens.
    findItem.mockResolvedValue(boundItem())
    const nonEmpty = makeDb([row('r1', 'a0', 'primary@x.com', null)])
    const ctx1 = makeCtx({ db: nonEmpty.db as never })
    await entitySink.upsertRecord(ctx1, fillBlank(), record('new@x.com'))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({})
    expect(nonEmpty.updateCalls).toHaveLength(0)

    update.mockClear()

    // Empty list → append + stamp.
    const empty = makeDb([])
    const ctx2 = makeCtx({ db: empty.db as never })
    await entitySink.upsertRecord(ctx2, fillBlank(), record('new@x.com'))
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[1]?.[1]).toEqual({ [EMAIL_KEY]: ['new@x.com'] })
    expect(empty.updateCalls).toEqual([{ managedByConnectorId: 'dc1' }])
  })

  it('a source null does NOT clear the list (never write null/empty over a multi field)', async () => {
    findItem.mockResolvedValue(boundItem())
    const { db, updateCalls } = makeDb([
      row('r1', 'a0', 'primary@x.com', null),
      row('r2', 'a1', 'alias@x.com', 'dc1'),
    ])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(
      ctx,
      mapping(),
      record(null, { identityCandidates: [] }) // present-but-null source key
    )

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toEqual({}) // key dropped — no null write
    expect(updateCalls).toHaveLength(0)
    expect(db.select).not.toHaveBeenCalled() // never even planned a row write
  })

  it('drifted-forever regression: a user alias on a multi overwrite field does not defeat the content-hash skip', async () => {
    const rec = record('a@x.com')
    findItem.mockResolvedValue(
      boundItem({
        contentHash: stableHash({ fields: rec.fields, displayName: rec.displayName }),
      })
    )
    const { db, selectDistinct } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), rec)

    // Multi fields are row-scoped OUT of drift detection → zero drift query,
    // content-hash skip fires.
    expect(selectDistinct).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(touchItem).toHaveBeenCalledTimes(1)
    expect(ctx.counters.skipped).toBe(1)
  })

  it('per-value uniqueness pre-flight: a conflicting value is dropped, the sync stays green', async () => {
    getCachedFieldMap.mockResolvedValue(new Map([[EMAIL_UUID, emailField({ isUnique: true })]]))
    checkUniqueValueTyped.mockRejectedValue(new Error('Value already exists'))
    findItem.mockResolvedValue(boundItem())
    const { db, updateCalls } = makeDb([row('r1', 'a0', 'primary@x.com', null)])
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('claimed@x.com'))

    expect(update).toHaveBeenCalledTimes(1) // no append attempted
    expect(updateCalls).toHaveLength(0)
    expect(ctx.counters.failed).toBe(0)
    expect(upsertItem).toHaveBeenCalledTimes(1) // record still binds + hashes
  })

  it('a UniqueValueConflictError from the write drops the value and retries — record never fails', async () => {
    // Scalar (non-multi) field: the conflict surfaces from inside handler.update
    // (A1's pre-hooks). First attempt throws, retry with the key dropped succeeds.
    getCachedFieldMap.mockResolvedValue(new Map([[EMAIL_UUID, emailField({ options: {} })]]))
    findItem.mockResolvedValue(boundItem())
    update.mockRejectedValueOnce(
      new UniqueValueConflictError({
        message: 'Email already in use',
        conflictingValue: 'claimed@x.com',
        fieldId: EMAIL_UUID,
      })
    )
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record('claimed@x.com'))

    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0]?.[1]).toEqual({ [EMAIL_KEY]: 'claimed@x.com' })
    expect(update.mock.calls[1]?.[1]).toEqual({}) // conflicting key dropped
    expect(ctx.counters.failed).toBe(0)
    expect(ctx.counters.updated).toBe(1)
    expect(upsertItem).toHaveBeenCalledTimes(1)
  })

  it('array-shaped match candidate: record FAILS visibly — no silent duplicate create', async () => {
    const { db } = makeDb()
    const ctx = makeCtx({ db: db as never })

    await entitySink.upsertRecord(ctx, mapping(), record(['a@x.com', 'b@x.com'] as never))

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(upsertItem).not.toHaveBeenCalled()
    expect(ctx.counters.failed).toBe(1)
    expect(ctx.counters.errorSample[0]?.error).toMatch(/array-shaped/)
  })

  it('two source records matching two aliases of one contact: first wins field writes, second still binds', async () => {
    // Neither record is bound; both match the same instance by (different) alias.
    lookupByField.mockImplementation(async (params: { candidates: Array<{ value: string }> }) => ({
      items: [
        {
          recordId: `${DEF_ID}:inst1`,
          matchedBy: { fieldId: EMAIL_KEY, value: params.candidates[0]!.value },
          displayName: 'Jane',
          secondaryDisplayValue: null,
          avatarUrl: null,
        },
      ],
      hasMore: false,
    }))
    const { db, updateCalls } = makeDb([row('r1', 'a0', 'a@x.com', null)])
    const ctx = makeCtx({ db: db as never })

    const recA = record('a@x.com', { externalId: 'srcA' })
    const recB = record('b@x.com', { externalId: 'srcB' })
    await entitySink.upsertRecord(ctx, mapping(), recA)
    await entitySink.upsertRecord(ctx, mapping(), recB)

    // A won (match-by-alias no-op: matched row IS the value — nothing written).
    // B lost the slice dedupe: field writes skipped entirely.
    expect(update).toHaveBeenCalledTimes(1) // A's (empty) scalar write only
    expect(updateCalls).toHaveLength(0)
    expect(create).not.toHaveBeenCalled()
    // BOTH bindings upserted onto the same instance.
    expect(upsertItem).toHaveBeenCalledTimes(2)
    expect(upsertItem.mock.calls[0]?.[1]).toMatchObject({
      externalId: 'srcA',
      entityInstanceId: 'inst1',
    })
    expect(upsertItem.mock.calls[1]?.[1]).toMatchObject({
      externalId: 'srcB',
      entityInstanceId: 'inst1',
    })
    expect(ctx.counters.skipped).toBe(1)
    expect(ctx.counters.failed).toBe(0)
  })
})
