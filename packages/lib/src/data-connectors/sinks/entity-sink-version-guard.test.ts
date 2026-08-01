// packages/lib/src/data-connectors/sinks/entity-sink-version-guard.test.ts
// Out-of-order write guard (sync-bridge §9 Q7). The high-concurrency webhook lane
// lets two events for one externalId race; the sink is last-write-wins, so a stale
// (strictly-older) write must be dropped. These tests pin: older ⇒ skip, equal/newer
// ⇒ write, missing stamp ⇒ today's last-write-wins, and the content-hash skip path
// advancing the stored stamp so the baseline stays a true high-watermark.

import { stableHash } from '@auxx/utils/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord, SyncCtx } from './types'

const findItem = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
vi.mock('../service', () => ({
  findItem: (...a: unknown[]) => findItem(...a),
  touchItem: (...a: unknown[]) => touchItem(...a),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
  listItemsForMapping: vi.fn(),
  markItemArchived: vi.fn(),
  setItemPendingRelations: vi.fn(),
}))

// Empty-field records never reach these, but the imports must resolve.
vi.mock('../../agents/bindings/resolve', () => ({ resolveConnectorFieldRef: vi.fn() }))
vi.mock('../field-id-resolver', () => ({ buildWriteKeyToFieldId: vi.fn() }))

import { entitySink } from './entity-sink'

/** Owned mapping with no field bindings — keeps the write set empty so the test
 *  exercises the guard/skip control flow, not the merge machinery. */
function mapping(): DecodedMapping {
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: 'def1',
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: [],
  } as unknown as DecodedMapping
}

function record(over: Partial<ProjectedRecord> = {}): ProjectedRecord {
  return {
    externalId: 'o1',
    displayName: 'Order',
    fields: {},
    identityCandidates: [],
    pendingRelations: [],
    ...over,
  }
}

const update = vi.fn().mockResolvedValue(undefined)
function makeCtx(): SyncCtx {
  return makeSyncCtx({
    runId: 'app-webhook:e1',
    crud: { update } as never,
    ownedCrud: { update } as never,
  })
}

const T1 = new Date('2026-06-21T00:00:00Z')
const T2 = new Date('2026-06-22T00:00:00Z')

beforeEach(() => {
  findItem.mockReset()
  touchItem.mockReset()
  upsertItem.mockReset()
  update.mockClear()
})

describe('entitySink out-of-order guard (§9 Q7)', () => {
  it('drops a STRICTLY-older write — touches the stamp, never writes the entity', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      upstreamUpdatedAt: T2, // stored is newer
      contentHash: 'whatever',
      pendingRelations: [],
    })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ upstreamUpdatedAt: T1 }))

    expect(update).not.toHaveBeenCalled()
    expect(upsertItem).not.toHaveBeenCalled()
    // Older event keeps the stored (newer) stamp — touched WITHOUT a new stamp arg.
    expect(touchItem).toHaveBeenCalledWith({}, 'item1', 'app-webhook:e1')
    expect(ctx.counters.skipped).toBe(1)
  })

  it('writes a NEWER event (content changed) and stores its stamp', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      upstreamUpdatedAt: T1, // stored is older
      contentHash: 'stale', // ≠ the empty-fields hash ⇒ no content-skip
      pendingRelations: [],
    })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ upstreamUpdatedAt: T2 }))

    expect(update).toHaveBeenCalledTimes(1)
    expect(upsertItem).toHaveBeenCalledTimes(1)
    expect(upsertItem.mock.calls[0]?.[1]).toMatchObject({ upstreamUpdatedAt: T2 })
  })

  it('lets an EQUAL stamp through (not strictly older)', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      upstreamUpdatedAt: T2,
      contentHash: 'stale',
      pendingRelations: [],
    })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ upstreamUpdatedAt: T2 }))

    expect(update).toHaveBeenCalledTimes(1)
    expect(upsertItem).toHaveBeenCalledTimes(1)
  })

  it('does not guard when the stored stamp is missing (today’s last-write-wins)', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      upstreamUpdatedAt: null,
      contentHash: 'stale',
      pendingRelations: [],
    })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ upstreamUpdatedAt: T1 }))

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('advances the stored stamp on a no-op content update (high-watermark)', async () => {
    // bound.contentHash === the hash the sink computes for this record ⇒ content-skip.
    const hash = stableHash({ fields: {}, displayName: 'Order' })
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      upstreamUpdatedAt: T1,
      contentHash: hash,
      pendingRelations: [],
    })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record({ upstreamUpdatedAt: T2 }))

    expect(update).not.toHaveBeenCalled()
    // Touched WITH the newer stamp so a later genuinely-older event is still caught.
    expect(touchItem).toHaveBeenCalledWith({}, 'item1', 'app-webhook:e1', T2)
    expect(ctx.counters.skipped).toBe(1)
  })
})
