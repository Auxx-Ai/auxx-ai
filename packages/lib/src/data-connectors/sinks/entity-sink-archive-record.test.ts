// packages/lib/src/data-connectors/sinks/entity-sink-archive-record.test.ts
// `archiveRecord`, the single seam every removal goes through — crawl reconciliation
// and the explicit-delete path both land here (v12 Phase 1).
//
// The behavior it is handed has already been resolved by the caller
// (`effectiveOrphanBehavior`), so these tests pin what each one DOES, not when it is
// chosen: `mark_deleted` flags the binding and leaves the record live, `archive`
// archives it unless a sibling binding still holds it, and `ignore` is inert.
//
// `mark_deleted` was a documented no-op stub before v12 ("no canonical status field is
// provisioned yet"), which mattered because it is the safe setting the whole crawl
// design leans on: an unminted record, a part with stock movements, and any crawl whose
// completeness is unproven all degrade to it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSyncCtx } from '../__test-helpers'
import type { SyncCtx } from './types'

const markItemArchived = vi.fn()
const markItemRemovedUpstream = vi.fn()
vi.mock('../service', () => ({
  findItem: vi.fn(),
  touchItem: vi.fn(),
  upsertItem: vi.fn(),
  listItemsForMapping: vi.fn(),
  markItemArchived: (...a: unknown[]) => markItemArchived(...a),
  markItemRemovedUpstream: (...a: unknown[]) => markItemRemovedUpstream(...a),
  setItemPendingRelations: vi.fn(),
}))
vi.mock('../../agents/bindings/resolve', () => ({ resolveConnectorFieldRef: vi.fn() }))
vi.mock('../field-id-resolver', () => ({ buildWriteKeyToFieldId: vi.fn() }))

import { entitySink } from './entity-sink'

const item = { id: 'item1', entityInstanceId: 'inst1', entityDefinitionId: 'def1' }

/**
 * A ctx whose `findOtherLiveBinding` lookup answers `sibling`, so `archive` can be
 * driven down either the real archive path or the shared-instance short-circuit.
 */
function ctx(opts: { sibling?: boolean; archiveFails?: boolean } = {}): SyncCtx {
  const archive = opts.archiveFails
    ? vi.fn().mockRejectedValue(new Error('archive blew up'))
    : vi.fn().mockResolvedValue(undefined)
  return makeSyncCtx({
    db: {
      query: {
        DataConnectorItem: {
          findFirst: vi.fn().mockResolvedValue(opts.sibling ? { id: 'other-item' } : undefined),
        },
      },
    },
    ownedCrud: { archive },
  } as unknown as Partial<SyncCtx>)
}

beforeEach(() => {
  markItemArchived.mockReset()
  markItemRemovedUpstream.mockReset()
})

describe('archiveRecord · mark_deleted', () => {
  it('flags the binding and leaves the record live', async () => {
    const c = ctx()
    await entitySink.archiveRecord(c, item, 'mark_deleted')

    expect(markItemRemovedUpstream).toHaveBeenCalledWith(c.db, 'item1', c.runId)
    expect(c.counters.markedDeleted).toBe(1)
    // The record itself is untouched: nothing archived, and no archive stamp that
    // would hide the binding from the next crawl's candidate set.
    expect(c.ownedCrud.archive).not.toHaveBeenCalled()
    expect(markItemArchived).not.toHaveBeenCalled()
    expect(c.counters.archived).toBe(0)
  })

  it('does not touch the def-invalidation set (nothing changed on the record)', async () => {
    const c = ctx()
    await entitySink.archiveRecord(c, item, 'mark_deleted')
    expect(c.touchedDefs.size).toBe(0)
  })
})

describe('archiveRecord · archive', () => {
  it('archives the record and stamps the binding', async () => {
    const c = ctx()
    await entitySink.archiveRecord(c, item, 'archive')

    expect(c.ownedCrud.archive).toHaveBeenCalledTimes(1)
    expect(markItemArchived).toHaveBeenCalledWith(c.db, 'item1', c.runId)
    expect(c.counters.archived).toBe(1)
    expect(c.touchedDefs.has('def1')).toBe(true)
    // Distinct counters: an archive is not also a flag.
    expect(c.counters.markedDeleted).toBe(0)
    expect(markItemRemovedUpstream).not.toHaveBeenCalled()
  })

  // Def-keyed sharing guard: one instance can be bound by two mappings (an embedded
  // child plus a sibling stream). While another binding is live the record stays.
  it('leaves the record alone when a sibling binding still holds it', async () => {
    const c = ctx({ sibling: true })
    await entitySink.archiveRecord(c, item, 'archive')

    expect(c.ownedCrud.archive).not.toHaveBeenCalled()
    expect(markItemArchived).toHaveBeenCalledWith(c.db, 'item1', c.runId)
    expect(c.counters.archived).toBe(0)
  })

  // A failed archive must not be counted as one, and must not throw: reconciliation
  // runs at finalize over many records, and one bad row cannot abort the rest.
  it('swallows a failing archive without counting it', async () => {
    const c = ctx({ archiveFails: true })
    await expect(entitySink.archiveRecord(c, item, 'archive')).resolves.toBeUndefined()
    expect(c.counters.archived).toBe(0)
  })
})

describe('archiveRecord · inert cases', () => {
  it('does nothing for ignore', async () => {
    const c = ctx()
    await entitySink.archiveRecord(c, item, 'ignore')
    expect(markItemRemovedUpstream).not.toHaveBeenCalled()
    expect(markItemArchived).not.toHaveBeenCalled()
    expect(c.ownedCrud.archive).not.toHaveBeenCalled()
  })

  // An unbound binding (never matched a record) has nothing to act on either way.
  it('does nothing when the binding has no instance', async () => {
    const c = ctx()
    await entitySink.archiveRecord(
      c,
      { id: 'item1', entityInstanceId: null, entityDefinitionId: 'def1' },
      'mark_deleted'
    )
    expect(markItemRemovedUpstream).not.toHaveBeenCalled()
    expect(c.counters.markedDeleted).toBe(0)
  })
})
