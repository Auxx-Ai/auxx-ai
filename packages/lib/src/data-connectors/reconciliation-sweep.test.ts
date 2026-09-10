// packages/lib/src/data-connectors/reconciliation-sweep.test.ts
// Step 8C, REVISED v9 §3 — reconcileOrphans is snapshot-only, unconditionally. An
// incremental stream NEVER archives orphans here, sweep or not: since v9 a sweep runs
// incremental streams as a watermark catch-up (not a full id-crawl), so absence no
// longer implies deletion even under `ctx.sweep`. The sink is mocked.
//
// v12 adds the three gates + two safety rules (see `reconciliation.ts`): a mapping opts
// in via `orphanBehavior` regardless of target mode, `archive` degrades to
// `mark_deleted` for a record this connector did not mint, and an implausible orphan
// set refuses the WHOLE pass.
//
// v12.1 (crawl-delete-reconciliation-fixes-plan): the wipe rule is judged per stream
// and floored on root mappings (Phase 2), the cap stamps the connector and a one-shot
// override lifts it (Phase 3), "minted" is answered per instance (Phase 4), and an
// already-flagged orphan is archived when its behavior now resolves to `archive`
// (Phase 6b). `./orphan-state` is mocked; the real SQL is covered by its own tests.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARCHIVE_CAP, capReason, reconcileOrphans, wipeReason } from './reconciliation'
import type { DecodedMapping } from './service'
import type { SyncCtx } from './sinks/types'

const listExistingItems = vi.fn()
const archiveRecord = vi.fn()
const setArchiveCapTripped = vi.fn()
const clearArchiveCapTripped = vi.fn()
const takeArchiveCapOverride = vi.fn()
const listMintedInstanceIds = vi.fn()

vi.mock('./sinks/entity-sink', () => ({
  entitySink: {
    listExistingItems: (...a: unknown[]) => listExistingItems(...a),
    archiveRecord: (...a: unknown[]) => archiveRecord(...a),
  },
}))

vi.mock('./orphan-state', () => ({
  setArchiveCapTripped: (...a: unknown[]) => setArchiveCapTripped(...a),
  clearArchiveCapTripped: (...a: unknown[]) => clearArchiveCapTripped(...a),
  takeArchiveCapOverride: (...a: unknown[]) => takeArchiveCapOverride(...a),
  listMintedInstanceIds: (...a: unknown[]) => listMintedInstanceIds(...a),
}))

const mapping = {
  row: { id: 'm1' },
  targetMode: 'owned',
  linkMode: 'upsert',
  orphanBehavior: 'archive',
  entityDefinitionId: 'def1',
  parentMappingId: null,
} as unknown as DecodedMapping

/** Same, but contributing into a shared platform def (Shopify products/parts). */
function contributing(
  orphanBehavior: string,
  linkMode = 'upsert',
  over: { id?: string; parentMappingId?: string | null } = {}
): DecodedMapping {
  return {
    row: { id: over.id ?? 'm-contrib' },
    targetMode: 'contributing',
    linkMode,
    orphanBehavior,
    entityDefinitionId: 'def1',
    parentMappingId: over.parentMappingId ?? null,
  } as unknown as DecodedMapping
}

/** A child mapping (an embedded variant under a product), never a root. */
function child(id: string, orphanBehavior = 'archive'): DecodedMapping {
  return contributing(orphanBehavior, 'upsert', { id, parentMappingId: 'm-root' })
}

/** An item row as `listExistingItems` returns it. Minted unless told otherwise. */
function item(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    entityInstanceId: `inst-${id}`,
    entityDefinitionId: 'def1',
    lastSeenRunId: 'run-old',
    mintedInstance: true,
    removedUpstreamAt: null,
    archivedAt: null,
    ...over,
  }
}

/** `n` orphans plus `seen` records seen this run — for exercising the cap. */
function population(orphans: number, seen: number) {
  return [
    ...Array.from({ length: orphans }, (_, i) => item(`orphan-${i}`)),
    ...Array.from({ length: seen }, (_, i) => item(`seen-${i}`, { lastSeenRunId: 'run-current' })),
  ]
}

/** The behavior each `archiveRecord` call actually asked for. */
function behaviors(): string[] {
  return archiveRecord.mock.calls.map((c) => c[2] as string)
}

/** The item id each `archiveRecord` call was given. */
function archivedIds(): string[] {
  return archiveRecord.mock.calls.map((c) => (c[1] as { id: string }).id)
}

function ctx(sweep: boolean): SyncCtx {
  return {
    runId: 'run-current',
    sweep,
    db: {},
    connector: { id: 'conn1' },
    counters: { errorSample: [] as unknown[] },
  } as unknown as SyncCtx
}

function capMessage(c: SyncCtx): string | undefined {
  return (c.counters.errorSample as Array<{ error: string }>)[0]?.error
}

beforeEach(() => {
  listExistingItems.mockReset()
  archiveRecord.mockReset()
  setArchiveCapTripped.mockReset()
  clearArchiveCapTripped.mockReset()
  takeArchiveCapOverride.mockReset().mockResolvedValue(null)
  listMintedInstanceIds.mockReset().mockResolvedValue(new Set())
  // One orphan (seen in an old run) + one seen this run.
  listExistingItems.mockResolvedValue([
    item('i-orphan'),
    item('i-seen', { lastSeenRunId: 'run-current' }),
  ])
})

describe('reconcileOrphans sweep gate', () => {
  it('skips an incremental stream when NOT a sweep (absence ≠ deletion)', async () => {
    await reconcileOrphans(ctx(false), [{ syncMode: 'incremental', mappings: [mapping] }])
    expect(listExistingItems).not.toHaveBeenCalled()
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  // REGRESSION GUARD (v9 §3): a sweep runs an incremental stream as a watermark
  // catch-up — it does NOT see every record — so archiving its unseen "orphans" would
  // mass-archive the whole stream. The old sweep override is gone; incremental streams
  // never archive here, sweep or not. Deletes on incremental streams come from delete
  // webhooks (or promoting the stream to syncMode='snapshot').
  it('still skips an incremental stream during a sweep (no mass-archive)', async () => {
    await reconcileOrphans(ctx(true), [{ syncMode: 'incremental', mappings: [mapping] }])
    expect(listExistingItems).not.toHaveBeenCalled()
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  it('still archives a snapshot stream regardless of the sweep flag', async () => {
    await reconcileOrphans(ctx(false), [{ syncMode: 'snapshot', mappings: [mapping] }])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
  })

  it('archives a snapshot stream during a sweep too', async () => {
    await reconcileOrphans(ctx(true), [{ syncMode: 'snapshot', mappings: [mapping] }])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
  })

  // plans/money/tasks/39 §6.3a: a snapshot crawl parked at the ingest ceiling resumes
  // across runs, so an item last seen in an EARLIER run of the same backfill is not an
  // orphan. `seenRunIds` (the runs since the stream's backfill began) widens the diff;
  // the finalizing run always counts, and a run from before the backfill never does.
  it('keeps an item last seen in an earlier run of the same backfill (seenRunIds)', async () => {
    listExistingItems.mockResolvedValue([
      item('i-old'),
      item('i-first', { lastSeenRunId: 'run-1' }),
      item('i-current', { lastSeenRunId: 'run-current' }),
      item('i-never', { lastSeenRunId: null }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [mapping], seenRunIds: new Set(['run-1']) },
    ])
    expect(archivedIds()).toEqual(['i-old', 'i-never'])
  })
})

// ── v12 Phase 2: the mapping opts in, target mode no longer decides ────────────────
describe('reconcileOrphans opt-in gate', () => {
  it('reconciles a CONTRIBUTING mapping that declares archive', async () => {
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
    expect(behaviors()).toEqual(['archive'])
  })

  it('reconciles a CONTRIBUTING mapping that declares mark_deleted', async () => {
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('mark_deleted')] },
    ])
    expect(behaviors()).toEqual(['mark_deleted'])
  })

  // The default has to stay inert: every mapping in the tree carries 'ignore' unless a
  // manifest says otherwise, so a bug here would archive on every connector at once.
  it('does nothing for a mapping left at the ignore default', async () => {
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('ignore')] },
    ])
    expect(listExistingItems).not.toHaveBeenCalled()
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  it('does nothing for a reference mapping, even one declaring archive', async () => {
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive', 'reference')] },
    ])
    expect(listExistingItems).not.toHaveBeenCalled()
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  // The snapshot gate outranks the declaration: opting in does not buy delete
  // detection on a stream whose fetch only ever saw a delta.
  it('still does nothing on an incremental stream that declares archive', async () => {
    await reconcileOrphans(ctx(true), [
      { syncMode: 'incremental', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
  })
})

// ── v12 Phase 3: never archive a record this connector did not create ─────────────
describe('reconcileOrphans minted guard', () => {
  it('degrades archive to mark_deleted for a record the connector did not mint', async () => {
    listExistingItems.mockResolvedValue([
      item('i-enriched', { mintedInstance: false }),
      item('i-seen', { lastSeenRunId: 'run-current' }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(behaviors()).toEqual(['mark_deleted'])
  })

  it('archives a minted record and flags a co-owned one in the same pass', async () => {
    listExistingItems.mockResolvedValue([
      item('i-mine'),
      item('i-theirs', { mintedInstance: false }),
      item('i-seen', { lastSeenRunId: 'run-current' }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(behaviors()).toEqual(['archive', 'mark_deleted'])
  })

  // mark_deleted is already the weaker outcome — the guard must not upgrade anything.
  it('leaves mark_deleted alone for an unminted record', async () => {
    listExistingItems.mockResolvedValue([
      item('i-theirs', { mintedInstance: false }),
      item('i-seen', { lastSeenRunId: 'run-current' }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('mark_deleted')] },
    ])
    expect(behaviors()).toEqual(['mark_deleted'])
  })
})

// ── v12.1 Phase 4: "minted" is a property of the instance, not the binding ─────────
describe('reconcileOrphans minted per instance', () => {
  it('asks the connector-wide minted set only for unminted archive candidates', async () => {
    listExistingItems
      .mockResolvedValueOnce([
        item('i-mine'),
        item('i-theirs', { mintedInstance: false }),
        item('i-seen', { lastSeenRunId: 'run-current' }),
      ])
      .mockResolvedValueOnce([item('i-flag-only', { mintedInstance: false })])
    await reconcileOrphans(ctx(false), [
      {
        syncMode: 'snapshot',
        mappings: [contributing('archive', 'upsert', { id: 'a' }), contributing('mark_deleted')],
      },
    ])
    expect(listMintedInstanceIds).toHaveBeenCalledTimes(1)
    expect(listMintedInstanceIds.mock.calls[0]?.[1]).toBe('conn1')
    expect(listMintedInstanceIds.mock.calls[0]?.[2]).toEqual(['inst-i-theirs'])
  })

  it('does not query at all when every archive candidate is minted on its own row', async () => {
    listExistingItems.mockResolvedValue([item('i-mine')])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(listMintedInstanceIds).not.toHaveBeenCalled()
    expect(behaviors()).toEqual(['archive'])
  })

  // Two mappings bound to ONE instance, only the first one's row minted. Judged per
  // row the second degrades, stays a live binding, and the sharing guard then never
  // lets the first archive the record. Judged per instance both resolve to `archive`
  // and `archiveRecord` runs twice; the guard test in entity-sink-archive-record.test.ts
  // covers the second call actually archiving.
  it('resolves a def-keyed sibling to archive when another binding minted the instance', async () => {
    listExistingItems
      .mockResolvedValueOnce([
        item('i-a', { entityInstanceId: 'inst-shared' }),
        item('i-seen', { lastSeenRunId: 'run-current' }),
      ])
      .mockResolvedValueOnce([
        item('i-b', { entityInstanceId: 'inst-shared', mintedInstance: false }),
      ])
    listMintedInstanceIds.mockResolvedValue(new Set(['inst-shared']))
    await reconcileOrphans(ctx(false), [
      {
        syncMode: 'snapshot',
        mappings: [
          contributing('archive', 'upsert', { id: 'a' }),
          contributing('archive', 'upsert', { id: 'b' }),
        ],
      },
    ])
    expect(archivedIds()).toEqual(['i-a', 'i-b'])
    expect(behaviors()).toEqual(['archive', 'archive'])
  })

  it('still degrades an instance no binding of the connector minted', async () => {
    listExistingItems.mockResolvedValue([item('i-theirs', { mintedInstance: false })])
    listMintedInstanceIds.mockResolvedValue(new Set())
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(behaviors()).toEqual(['mark_deleted'])
  })
})

// ── v12 Phase 3b / v12.1 Phase 6b: an already-handled orphan ──────────────────────
describe('reconcileOrphans idempotency', () => {
  // v12.1 Phase 6b changed this test: an already-FLAGGED item is still kept out of the
  // cap and never re-flagged, but when its behavior resolves to `archive` it IS archived
  // now. Under this `archive` mapping the flagged item is minted, so it goes through.
  it('skips items already archived or unbound, never re-flags, but finishes a flagged archive', async () => {
    listExistingItems.mockResolvedValue([
      item('i-archived', { archivedAt: new Date() }),
      item('i-flagged', { removedUpstreamAt: new Date() }),
      item('i-unbound', { entityInstanceId: null }),
      item('i-fresh'),
      item('i-seen', { lastSeenRunId: 'run-current' }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archivedIds()).toEqual(['i-fresh', 'i-flagged'])
    expect(behaviors()).toEqual(['archive', 'archive'])
  })

  it('never re-flags an already-flagged item under mark_deleted', async () => {
    listExistingItems.mockResolvedValue([
      item('i-flagged', { removedUpstreamAt: new Date() }),
      item('i-fresh'),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('mark_deleted')] },
    ])
    expect(archivedIds()).toEqual(['i-fresh'])
  })

  it('never re-flags a flagged item whose archive still degrades (unminted)', async () => {
    listExistingItems.mockResolvedValue([
      item('i-flagged', { removedUpstreamAt: new Date(), mintedInstance: false }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
  })

  // A policy flip from mark_deleted to archive: the items an earlier pass flagged are
  // exactly the ones the new policy wants archived, and they are not "fresh"
  // disappearances, so the cap must not see them at all.
  it('archives every already-flagged item after a mark_deleted to archive flip, outside the cap', async () => {
    listExistingItems.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => item(`flag-${i}`, { removedUpstreamAt: new Date() }))
    )
    const c = ctx(false)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).toHaveBeenCalledTimes(10)
    expect(capMessage(c)).toBeUndefined()
    expect(setArchiveCapTripped).not.toHaveBeenCalled()
  })

  it('does not archive a flagged item the crawl saw again this run', async () => {
    listExistingItems.mockResolvedValue([
      item('i-back', { removedUpstreamAt: new Date(), lastSeenRunId: 'run-current' }),
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
  })
})

// ── v12 Phase 4: 🛑 the archive cap ───────────────────────────────────────────────
//
// Every other safety gate in the engine protects against an INCOMPLETE crawl. These
// protect against a crawl that completed while seeing the wrong set of records, which
// is the failure that would otherwise archive a whole catalog in one night.
describe('reconcileOrphans archive cap', () => {
  it('refuses the pass and fails the run when EVERY bound record vanished', async () => {
    listExistingItems.mockResolvedValue(population(8, 0))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('every bound record (8) vanished')
  })

  it('refuses the pass past the absolute cap', async () => {
    listExistingItems.mockResolvedValue(population(501, 5_000))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('cap 500')
  })

  it('refuses the pass past the proportion cap', async () => {
    listExistingItems.mockResolvedValue(population(30, 70))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('30 of 100 bound records (30%)')
  })

  // The floor is what stops the proportion rule from crying wolf: 3 of 10 products
  // deleted is 30% and completely ordinary. Only the total-wipe rule guards small sets.
  it('allows an ordinary deletion on a small catalog (below the floor)', async () => {
    listExistingItems.mockResolvedValue(population(3, 7))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).toHaveBeenCalledTimes(3)
    expect(capMessage(c)).toBeUndefined()
  })

  it('allows a large but proportionally small deletion', async () => {
    listExistingItems.mockResolvedValue(population(100, 5_000))
    await reconcileOrphans(ctx(true), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(100)
  })

  // The cap is judged connector-wide on purpose. A crawl that came back empty must trip
  // ONCE for everything, not archive the first mapping and then think better of it.
  it('refuses every mapping together, not just the one that tripped it', async () => {
    listExistingItems
      .mockResolvedValueOnce(population(1, 40))
      .mockResolvedValueOnce(population(600, 100))
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', mappings: [contributing('archive'), contributing('mark_deleted')] },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('601')
  })

  // A mapping bound to ONE record has to stay reconcilable: with a single record there
  // is nothing that separates a real deletion from an empty crawl, and refusing forever
  // would mean it could never be reconciled at all.
  it('allows a single-record mapping to reconcile its one deletion', async () => {
    listExistingItems.mockResolvedValue([item('i-only')])
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
    expect(capMessage(c)).toBeUndefined()
  })

  it('refuses a two-record mapping that lost both at once', async () => {
    listExistingItems.mockResolvedValue([item('i-a'), item('i-b')])
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('every bound record (2) vanished')
  })

  it('is silent when there are no orphans at all', async () => {
    listExistingItems.mockResolvedValue(population(0, 40))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(c.counters.errorSample).toHaveLength(0)
  })
})

// ── v12.1 Phase 2: cap arithmetic that matches its own reasoning ──────────────────
//
// The wipe rule was justified per mapping but summed connector-wide, so one upstream
// record fanning out to three bindings tripped "every bound record vanished" on a
// one-product store, forever. It is now per stream and floored on ROOT mappings; the
// absolute and proportion rules stay connector-wide, with `bound` counted over every
// eligible mapping including the ones that lost nothing.
describe('reconcileOrphans cap arithmetic (v12.1 Phase 2)', () => {
  const root = contributing('archive', 'upsert', { id: 'm-root', parentMappingId: null })

  // A one-product store: product, part, variant are three bindings of ONE upstream
  // record. Deleting the product is root 1, so it is a deletion, not a wipe.
  it('archives one root record fanned out over three mappings when it is deleted', async () => {
    listExistingItems.mockResolvedValue([item('i-x')])
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', streamKey: 'products', mappings: [root, child('m-a'), child('m-b')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(3)
    expect(capMessage(c)).toBeUndefined()
  })

  it('refuses two root records both gone across three mappings, naming the stream', async () => {
    listExistingItems
      .mockResolvedValueOnce([item('p-1'), item('p-2')])
      .mockResolvedValueOnce([item('a-1'), item('a-2')])
      .mockResolvedValueOnce([item('b-1'), item('b-2')])
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', streamKey: 'products', mappings: [root, child('m-a'), child('m-b')] },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('stream "products"')
    expect(capMessage(c)).toContain('every bound record (6) vanished')
  })

  it('archives one root with five children, all gone (root 1 is not a wipe)', async () => {
    listExistingItems.mockResolvedValueOnce([item('p-1')]).mockResolvedValueOnce(population(5, 0))
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', streamKey: 'products', mappings: [root, child('m-variants')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(6)
    expect(capMessage(c)).toBeUndefined()
  })

  // Names the stream through the full `StreamWithMappings` shape too.
  it('reads the stream key off the full stream row shape', async () => {
    listExistingItems.mockResolvedValue([item('i-a'), item('i-b')])
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', stream: { streamKey: 'customers' }, mappings: [root] },
    ])
    expect(capMessage(c)).toContain('stream "customers"')
  })

  // The proportion denominator used to skip mappings with zero orphans, which made the
  // rule stricter than its own comment: 30 of 200 is 15%, allowed.
  it('counts a mapping with zero orphans in the proportion denominator', async () => {
    listExistingItems
      .mockResolvedValueOnce(population(30, 70))
      .mockResolvedValueOnce(population(0, 100))
    const c = ctx(true)
    await reconcileOrphans(c, [
      {
        syncMode: 'snapshot',
        mappings: [root, contributing('archive', 'upsert', { id: 'm-other' })],
      },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(30)
    expect(capMessage(c)).toBeUndefined()
  })

  // The wipe is per STREAM: a second stream that kept every record does not dilute an
  // empty crawl on the first one.
  it('trips the wipe on one stream even when another stream is intact', async () => {
    listExistingItems
      .mockResolvedValueOnce([item('p-1'), item('p-2')])
      .mockResolvedValueOnce(population(0, 50))
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', streamKey: 'products', mappings: [root] },
      {
        syncMode: 'snapshot',
        streamKey: 'customers',
        mappings: [contributing('archive', 'upsert', { id: 'm-cust' })],
      },
    ])
    expect(archiveRecord).not.toHaveBeenCalled()
    expect(capMessage(c)).toContain('stream "products"')
  })

  // The wipe needs EVERY actionable record of the stream gone. A child that survived
  // means the crawl did return something, so this is a (large) deletion, not a wipe.
  it('does not call it a wipe when a child record survived', async () => {
    listExistingItems
      .mockResolvedValueOnce([item('p-1'), item('p-2')])
      .mockResolvedValueOnce([item('v-1', { lastSeenRunId: 'run-current' })])
    const c = ctx(true)
    await reconcileOrphans(c, [
      { syncMode: 'snapshot', streamKey: 'products', mappings: [root, child('m-variants')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(2)
    expect(capMessage(c)).toBeUndefined()
  })
})

// ── v12.1 Phase 3: the cap is visible on the connector and a human can confirm it ──
describe('reconcileOrphans archive cap state (v12.1 Phase 3)', () => {
  it('stamps archiveCapTripped on a trip, with the numbers and the reason', async () => {
    listExistingItems.mockResolvedValue(population(30, 70))
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(setArchiveCapTripped).toHaveBeenCalledTimes(1)
    const [, connectorId, stamp] = setArchiveCapTripped.mock.calls[0] as [
      unknown,
      string,
      { at: string; runId: string; orphans: number; bound: number; reason: string },
    ]
    expect(connectorId).toBe('conn1')
    expect(stamp.runId).toBe('run-current')
    expect(stamp.orphans).toBe(30)
    expect(stamp.bound).toBe(100)
    expect(stamp.reason).toContain('30 of 100 bound records (30%)')
    expect(Number.isNaN(Date.parse(stamp.at))).toBe(false)
    expect(clearArchiveCapTripped).not.toHaveBeenCalled()
    // The run still reads partial: the errorSample push stays.
    expect(capMessage(c)).toContain('Delete reconciliation refused')
  })

  it('clears the stamp on a clean pass that archived something', async () => {
    listExistingItems.mockResolvedValue(population(3, 7))
    await reconcileOrphans(ctx(true), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(clearArchiveCapTripped).toHaveBeenCalledWith(expect.anything(), 'conn1')
    expect(setArchiveCapTripped).not.toHaveBeenCalled()
  })

  it('clears the stamp on a pass with zero orphans', async () => {
    listExistingItems.mockResolvedValue(population(0, 40))
    await reconcileOrphans(ctx(true), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(clearArchiveCapTripped).toHaveBeenCalledTimes(1)
  })

  it('clears the stamp on a pass where every stream was skipped', async () => {
    await reconcileOrphans(ctx(false), [{ syncMode: 'incremental', mappings: [mapping] }])
    expect(clearArchiveCapTripped).toHaveBeenCalledTimes(1)
    expect(setArchiveCapTripped).not.toHaveBeenCalled()
  })

  it('under an override, skips the cap, archives, and does not stamp a trip', async () => {
    listExistingItems.mockResolvedValue(population(30, 70))
    takeArchiveCapOverride.mockResolvedValue({ at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' })
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).toHaveBeenCalledTimes(30)
    expect(capMessage(c)).toBeUndefined()
    expect(setArchiveCapTripped).not.toHaveBeenCalled()
    expect(clearArchiveCapTripped).toHaveBeenCalledTimes(1)
  })

  it('under an override, lifts the wipe rule too', async () => {
    listExistingItems.mockResolvedValue(population(8, 0))
    takeArchiveCapOverride.mockResolvedValue({ at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' })
    const c = ctx(true)
    await reconcileOrphans(c, [{ syncMode: 'snapshot', mappings: [contributing('archive')] }])
    expect(archiveRecord).toHaveBeenCalledTimes(8)
    expect(capMessage(c)).toBeUndefined()
  })

  // The override is consumed by the pass it lands on, whatever the pass finds: it is
  // a take-and-clear, so calling it once IS the clear.
  it('consumes the override exactly once per pass, even a pass that finds nothing', async () => {
    listExistingItems.mockResolvedValue(population(0, 40))
    takeArchiveCapOverride.mockResolvedValue({ at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' })
    await reconcileOrphans(ctx(true), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(takeArchiveCapOverride).toHaveBeenCalledTimes(1)
    expect(takeArchiveCapOverride).toHaveBeenCalledWith(expect.anything(), 'conn1')
  })

  // A human confirming a deletion is not authority to archive a record the connector
  // did not create: the mint degrade still applies under an override.
  it('under an override, still degrades archive to mark_deleted for an unminted record', async () => {
    listExistingItems.mockResolvedValue([
      ...population(30, 70),
      item('i-theirs', { mintedInstance: false }),
    ])
    takeArchiveCapOverride.mockResolvedValue({ at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' })
    await reconcileOrphans(ctx(true), [
      { syncMode: 'snapshot', mappings: [contributing('archive')] },
    ])
    expect(archiveRecord).toHaveBeenCalledTimes(31)
    expect(behaviors().filter((b) => b === 'mark_deleted')).toHaveLength(1)
    expect(archiveRecord.mock.calls.at(-1)?.[2]).toBe('mark_deleted')
  })
})

// The thresholds themselves, stated against realistic catalog sizes (DemoOrg1 carries
// 246 parts) so the numbers are judged against real data rather than invented ones.
// This is the whole policy on one screen — if a threshold moves, this table is the
// argument for whether the new one is defensible. Every orphan here is a root orphan,
// which is the single-mapping case the table was written for.
describe('archive cap thresholds', () => {
  const refusedBy = (orphans: number, bound: number) =>
    capReason({ orphans, bound }) ?? wipeReason({ bound, orphans, rootOrphans: orphans })

  const cases: Array<[string, number, number, boolean]> = [
    // label,                                    orphans, bound,  refused
    ['nothing deleted', 0, 246, false],
    ['one product of 246', 1, 246, false],
    ['three of ten (ordinary, 30%)', 3, 10, false],
    ['single-record mapping loses its one record', 1, 1, false],
    ['24 of 246, just under the floor', 24, 246, false],
    ['25 of 246 at the floor but only 10%', 25, 246, false],
    ['60 of 246 (24%)', 60, 246, true],
    ['two-record mapping loses both', 2, 2, true],
    ['246 of 246 — the empty crawl', 246, 246, true],
    ['501 of 50k — large but only 1%', 501, 50_000, true],
  ]

  for (const [label, orphans, bound, refused] of cases) {
    it(`${refused ? 'refuses' : 'allows'}: ${label}`, () => {
      expect(refusedBy(orphans, bound) !== null).toBe(refused)
    })
  }

  it('exposes the thresholds it enforces', () => {
    expect(ARCHIVE_CAP).toEqual({ absolute: 500, fraction: 0.2, floor: 25, wipeFloor: 2 })
  })
})

describe('wipeReason (per stream, floored on root mappings)', () => {
  it('is silent with no orphans', () => {
    expect(wipeReason({ bound: 0, orphans: 0, rootOrphans: 0 })).toBeNull()
  })

  it('needs every actionable record gone', () => {
    expect(wipeReason({ bound: 5, orphans: 4, rootOrphans: 4 })).toBeNull()
  })

  it('needs at least wipeFloor root orphans, however many children went with them', () => {
    expect(wipeReason({ bound: 6, orphans: 6, rootOrphans: 1 })).toBeNull()
    expect(wipeReason({ bound: 6, orphans: 6, rootOrphans: 2 })).toContain(
      'every bound record (6) vanished'
    )
  })
})

describe('capReason (connector-wide)', () => {
  it('never reads the wipe rule', () => {
    expect(capReason({ orphans: 2, bound: 2 })).toBeNull()
  })

  it('reports the absolute cap before the proportion', () => {
    expect(capReason({ orphans: 501, bound: 600 })).toContain('cap 500')
  })

  it('reports the proportion with its percentage', () => {
    expect(capReason({ orphans: 60, bound: 246 })).toBe(
      '60 of 246 bound records (24%) vanished from the crawl'
    )
  })
})
