// packages/lib/src/data-connectors/sinks/entity-sink-restore.test.ts
// Reappearance heals the record, not only the binding (v12.1 Phase 1). A record this
// connector archived on an earlier reconcile (item.archivedAt set) that is back in the
// crawl is restored before the content-hash fast path, so an unchanged record comes
// back too. Only the connector's own archive is undone: a human archive leaves
// item.archivedAt null and the sink never touches it, and under the def-keyed sharing
// guard the binding is stamped while the record stays live, which must not count as
// a restore.

import { stableHash } from '@auxx/utils/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord } from './types'

const findItem = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
/** The un-mocked `touchItem`, captured inside the factory (a plain import would
 *  resolve to the mock and recurse). */
const real = vi.hoisted(() => ({
  touchItem: undefined as undefined | ((...a: unknown[]) => Promise<void>),
}))
vi.mock('../service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service')>()
  real.touchItem = actual.touchItem as unknown as (...a: unknown[]) => Promise<void>
  return {
    ...actual,
    findItem: (...a: unknown[]) => findItem(...a),
    // Delegates so one case can swap in the real `touchItem` (see the last describe).
    touchItem: (...a: unknown[]) => touchItem(...a),
    upsertItem: (...a: unknown[]) => upsertItem(...a),
    listItemsForMapping: vi.fn(),
    markItemArchived: vi.fn(),
    setItemPendingRelations: vi.fn(),
  }
})

// Empty-field records never reach these, but the imports must resolve.
vi.mock('../../agents/bindings/resolve', () => ({ resolveConnectorFieldRef: vi.fn() }))
vi.mock('../field-id-resolver', () => ({ buildWriteKeyToFieldId: vi.fn() }))

import { entitySink } from './entity-sink'

/** Owned mapping with no field bindings: the write set stays empty, so the case
 *  exercises the restore + skip control flow, not the merge machinery. */
function mapping(over: Partial<DecodedMapping> = {}): DecodedMapping {
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: 'def1',
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'archive',
    fieldMappings: [],
    ...over,
  } as unknown as DecodedMapping
}

function record(over: Partial<ProjectedRecord> = {}): ProjectedRecord {
  return {
    externalId: 'p1',
    displayName: 'Product',
    fields: {},
    identityCandidates: [],
    pendingRelations: [],
    ...over,
  }
}

/** The hash the sink computes for `record()`, so `bound.contentHash` matches it. */
const UNCHANGED = stableHash({ fields: {}, displayName: 'Product' })
const ARCHIVED_AT = new Date('2026-06-20T00:00:00Z')

function boundItem(over: Record<string, unknown> = {}) {
  return {
    id: 'item1',
    entityInstanceId: 'inst1',
    upstreamUpdatedAt: null,
    contentHash: UNCHANGED,
    pendingRelations: [],
    linkedRelations: [],
    archivedAt: null,
    removedUpstreamAt: null,
    ...over,
  }
}

/**
 * A ctx whose `EntityInstance.findFirst` answers the record's archived state, and
 * whose crud handlers spy `restore`. `update` is stubbed so a fall-through write
 * (content changed) does not blow up on the empty handler.
 */
function ctx(opts: { instanceArchived?: boolean; restoreFails?: boolean } = {}) {
  const restore = opts.restoreFails
    ? vi.fn().mockRejectedValue(new Error('restore blew up'))
    : vi.fn().mockResolvedValue(undefined)
  const ownedRestore = vi.fn().mockResolvedValue(undefined)
  const findFirst = vi.fn().mockResolvedValue({
    archivedAt: opts.instanceArchived ? ARCHIVED_AT : null,
  })
  const set = vi.fn((_payload: Record<string, unknown>) => ({ where: vi.fn(async () => {}) }))
  const db = {
    query: { EntityInstance: { findFirst } },
    update: vi.fn(() => ({ set })),
  }
  const c = makeSyncCtx({
    db: db as never,
    crud: { restore: vi.fn(), update: vi.fn() } as never,
    ownedCrud: { restore: opts.restoreFails ? restore : ownedRestore, update: vi.fn() } as never,
  })
  return { c, findFirst, set, ownedRestore: opts.restoreFails ? restore : ownedRestore }
}

beforeEach(() => {
  findItem.mockReset()
  touchItem.mockReset()
  upsertItem.mockReset()
})

describe('upsertRecord restores a record this connector archived', () => {
  it('restores, counts, and still takes the unchanged fast path', async () => {
    findItem.mockResolvedValue(boundItem({ archivedAt: ARCHIVED_AT }))
    const { c, ownedRestore } = ctx({ instanceArchived: true })

    await entitySink.upsertRecord(c, mapping(), record())

    expect(ownedRestore).toHaveBeenCalledTimes(1)
    expect(ownedRestore).toHaveBeenCalledWith('def1:inst1')
    expect(c.counters.restored).toBe(1)
    expect(c.touchedDefs.has('def1')).toBe(true)
    // Content unchanged: the fast path still runs, and its touch clears the stamps.
    expect(touchItem).toHaveBeenCalledWith(c.db, 'item1', 'run1', undefined)
    expect(upsertItem).not.toHaveBeenCalled()
    expect(c.counters.skipped).toBe(1)
  })

  it('uses the guarded handler for a contributing mapping', async () => {
    findItem.mockResolvedValue(boundItem({ archivedAt: ARCHIVED_AT }))
    const { c, ownedRestore } = ctx({ instanceArchived: true })

    await entitySink.upsertRecord(c, mapping({ targetMode: 'contributing' }), record())

    expect(c.crud.restore).toHaveBeenCalledWith('def1:inst1')
    expect(ownedRestore).not.toHaveBeenCalled()
    expect(c.counters.restored).toBe(1)
  })

  it('restores before a changed-content write too', async () => {
    findItem.mockResolvedValue(boundItem({ archivedAt: ARCHIVED_AT, contentHash: 'stale' }))
    const { c, ownedRestore } = ctx({ instanceArchived: true })

    await entitySink.upsertRecord(c, mapping(), record())

    expect(ownedRestore).toHaveBeenCalledTimes(1)
    expect(c.counters.restored).toBe(1)
    // The normal write path follows and clears the item stamps via upsertItem.
    expect(upsertItem).toHaveBeenCalledTimes(1)
    expect(touchItem).not.toHaveBeenCalled()
  })

  // Sharing guard: `archiveRecord` stamped this binding but a sibling kept the record
  // live. `restoreEntity` on a live record rewrites `updatedAt` and is not free, and
  // counting it would report a restore that never happened.
  it('skips a binding stamped archived whose record is still live (sharing guard)', async () => {
    findItem.mockResolvedValue(boundItem({ archivedAt: ARCHIVED_AT }))
    const { c, ownedRestore, findFirst } = ctx({ instanceArchived: false })

    await entitySink.upsertRecord(c, mapping(), record())

    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(ownedRestore).not.toHaveBeenCalled()
    expect(c.counters.restored).toBe(0)
    // The binding's own stamp is still cleared by the seen-alive touch.
    expect(touchItem).toHaveBeenCalledTimes(1)
  })

  it('swallows a failing restore without counting it, and still touches the item', async () => {
    findItem.mockResolvedValue(boundItem({ archivedAt: ARCHIVED_AT }))
    const { c } = ctx({ instanceArchived: true, restoreFails: true })

    await expect(entitySink.upsertRecord(c, mapping(), record())).resolves.toBeUndefined()

    expect(c.counters.restored).toBe(0)
    expect(touchItem).toHaveBeenCalledTimes(1)
    expect(c.counters.skipped).toBe(1)
  })
})

describe('upsertRecord never restores what the connector did not archive', () => {
  it('a binding with only removedUpstreamAt is touched, not restored', async () => {
    findItem.mockResolvedValue(boundItem({ removedUpstreamAt: ARCHIVED_AT }))
    const { c, ownedRestore, findFirst } = ctx({ instanceArchived: false })

    await entitySink.upsertRecord(c, mapping(), record())

    expect(findFirst).not.toHaveBeenCalled()
    expect(ownedRestore).not.toHaveBeenCalled()
    expect(c.counters.restored).toBe(0)
    expect(touchItem).toHaveBeenCalledWith(c.db, 'item1', 'run1', undefined)
  })

  // A human archived the record: the instance is archived but the binding carries no
  // connector archive stamp. Reappearance upstream is not authority to undo that.
  it('a human archive (item.archivedAt null, instance archived) is left alone', async () => {
    findItem.mockResolvedValue(boundItem())
    const { c, ownedRestore, findFirst } = ctx({ instanceArchived: true })

    await entitySink.upsertRecord(c, mapping(), record())

    expect(findFirst).not.toHaveBeenCalled()
    expect(ownedRestore).not.toHaveBeenCalled()
    expect(c.crud.restore).not.toHaveBeenCalled()
    expect(c.counters.restored).toBe(0)
    expect(touchItem).toHaveBeenCalledTimes(1)
  })
})

// Every other sink test mocks `touchItem`, which is how the seen-alive stamp shipped
// without clearing the flags. This case routes the sink's call to the real function
// and reads the update payload off the db double.
describe('upsertRecord fast path with the real touchItem', () => {
  it('clears removedUpstreamAt and archivedAt on the binding', async () => {
    findItem.mockResolvedValue(
      boundItem({ archivedAt: ARCHIVED_AT, removedUpstreamAt: ARCHIVED_AT })
    )
    const { c, set } = ctx({ instanceArchived: true })
    touchItem.mockImplementation((...a: unknown[]) => real.touchItem!(...a))

    await entitySink.upsertRecord(c, mapping(), record())

    expect(c.counters.restored).toBe(1)
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[0]?.[0]).toMatchObject({
      lastSeenRunId: 'run1',
      removedUpstreamAt: null,
      archivedAt: null,
    })
  })
})
