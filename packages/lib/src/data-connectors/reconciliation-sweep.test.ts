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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARCHIVE_CAP, archiveCapReason, reconcileOrphans } from './reconciliation'
import type { DecodedMapping } from './service'
import type { SyncCtx } from './sinks/types'

const listExistingItems = vi.fn()
const archiveRecord = vi.fn()

vi.mock('./sinks/entity-sink', () => ({
  entitySink: {
    listExistingItems: (...a: unknown[]) => listExistingItems(...a),
    archiveRecord: (...a: unknown[]) => archiveRecord(...a),
  },
}))

const mapping = {
  row: { id: 'm1' },
  targetMode: 'owned',
  linkMode: 'upsert',
  orphanBehavior: 'archive',
  entityDefinitionId: 'def1',
} as unknown as DecodedMapping

/** Same, but contributing into a shared platform def (Shopify products/parts). */
function contributing(orphanBehavior: string, linkMode = 'upsert'): DecodedMapping {
  return {
    row: { id: 'm-contrib' },
    targetMode: 'contributing',
    linkMode,
    orphanBehavior,
    entityDefinitionId: 'def1',
  } as unknown as DecodedMapping
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

function ctx(sweep: boolean): SyncCtx {
  return {
    runId: 'run-current',
    sweep,
    connector: { id: 'conn1' },
    counters: { errorSample: [] as unknown[] },
  } as unknown as SyncCtx
}

beforeEach(() => {
  listExistingItems.mockReset()
  archiveRecord.mockReset()
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
    const archivedIds = archiveRecord.mock.calls.map((c) => (c[1] as { id: string }).id)
    expect(archivedIds).toEqual(['i-old', 'i-never'])
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

// ── v12 Phase 3b: an already-handled orphan is not re-handled ─────────────────────
describe('reconcileOrphans idempotency', () => {
  it('skips items already archived or already flagged', async () => {
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
    const ids = archiveRecord.mock.calls.map((c) => (c[1] as { id: string }).id)
    expect(ids).toEqual(['i-fresh'])
  })
})

// ── v12 Phase 4: 🛑 the archive cap ───────────────────────────────────────────────
//
// Every other safety gate in the engine protects against an INCOMPLETE crawl. These
// protect against a crawl that completed while seeing the wrong set of records, which
// is the failure that would otherwise archive a whole catalog in one night.
describe('reconcileOrphans archive cap', () => {
  function capMessage(c: SyncCtx): string | undefined {
    return (c.counters.errorSample as Array<{ error: string }>)[0]?.error
  }

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

// The thresholds themselves, stated against realistic catalog sizes (DemoOrg1 carries
// 246 parts) so the numbers are judged against real data rather than invented ones.
// This is the whole policy on one screen — if a threshold moves, this table is the
// argument for whether the new one is defensible.
describe('archiveCapReason thresholds', () => {
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
      expect(archiveCapReason(orphans, bound) !== null).toBe(refused)
    })
  }

  it('exposes the thresholds it enforces', () => {
    expect(ARCHIVE_CAP).toEqual({ absolute: 500, fraction: 0.2, floor: 25, wipeFloor: 2 })
  })
})
