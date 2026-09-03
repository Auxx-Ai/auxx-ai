// packages/lib/src/data-connectors/reconciliation-sweep.test.ts
// Step 8C, REVISED v9 §3 — reconcileOrphans is snapshot-only, unconditionally. An
// incremental stream NEVER archives orphans here, sweep or not: since v9 a sweep runs
// incremental streams as a watermark catch-up (not a full id-crawl), so absence no
// longer implies deletion even under `ctx.sweep`. The sink is mocked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileOrphans } from './reconciliation'
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

function ctx(sweep: boolean): SyncCtx {
  return { runId: 'run-current', sweep } as unknown as SyncCtx
}

beforeEach(() => {
  listExistingItems.mockReset()
  archiveRecord.mockReset()
  // One orphan (seen in an old run) + one seen this run.
  listExistingItems.mockResolvedValue([
    {
      id: 'i-orphan',
      entityInstanceId: 'inst1',
      entityDefinitionId: 'def1',
      lastSeenRunId: 'run-old',
    },
    {
      id: 'i-seen',
      entityInstanceId: 'inst2',
      entityDefinitionId: 'def1',
      lastSeenRunId: 'run-current',
    },
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
      { id: 'i-old', entityInstanceId: 'i0', entityDefinitionId: 'def1', lastSeenRunId: 'run-old' },
      { id: 'i-first', entityInstanceId: 'i1', entityDefinitionId: 'def1', lastSeenRunId: 'run-1' },
      {
        id: 'i-current',
        entityInstanceId: 'i2',
        entityDefinitionId: 'def1',
        lastSeenRunId: 'run-current',
      },
      { id: 'i-never', entityInstanceId: 'i3', entityDefinitionId: 'def1', lastSeenRunId: null },
    ])
    await reconcileOrphans(ctx(false), [
      { syncMode: 'snapshot', mappings: [mapping], seenRunIds: new Set(['run-1']) },
    ])
    const archivedIds = archiveRecord.mock.calls.map((c) => (c[1] as { id: string }).id)
    expect(archivedIds).toEqual(['i-old', 'i-never'])
  })
})
