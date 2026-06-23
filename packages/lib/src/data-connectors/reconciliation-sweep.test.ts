// packages/lib/src/data-connectors/reconciliation-sweep.test.ts
// Step 8C — the sweep gate on reconcileOrphans. An incremental stream normally skips
// orphan archival (absence ≠ deletion); under `ctx.sweep` (a full id-crawl) it
// archives the unseen orphans, since absence IS deletion. The sink is mocked.

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

  it('archives the unseen orphan of an incremental stream during a sweep', async () => {
    await reconcileOrphans(ctx(true), [{ syncMode: 'incremental', mappings: [mapping] }])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
    expect(archiveRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'i-orphan' }),
      'archive'
    )
  })

  it('still archives a snapshot stream regardless of the sweep flag', async () => {
    await reconcileOrphans(ctx(false), [{ syncMode: 'snapshot', mappings: [mapping] }])
    expect(archiveRecord).toHaveBeenCalledTimes(1)
  })
})
