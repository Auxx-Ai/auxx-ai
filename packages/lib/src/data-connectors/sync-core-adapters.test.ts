// packages/lib/src/data-connectors/sync-core-adapters.test.ts

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { SyncRunErrorSample, SyncState } from '../sync-core/contracts'
import {
  applySyncStateToStream,
  createConnectorRunLedger,
  syncStateFromStream,
} from './sync-core-adapters'
import type { ConnectorStreamState } from './types'

describe('syncStateFromStream', () => {
  it('treats an empty stream state as a fresh backfill', () => {
    expect(syncStateFromStream({})).toEqual({
      phase: 'backfill',
      cursor: undefined,
      watermark: undefined,
      recordsSeen: undefined,
      backfillStartedAt: undefined,
    })
  })

  it('projects the structured backfillCursor + sync fields onto SyncState', () => {
    const state: ConnectorStreamState = {
      phase: 'steady',
      backfillCursor: { kind: 'token', value: 'pg_2' },
      watermark: '2026-06-22T00:00:00Z',
      recordsSeen: 4200,
      backfillStartedAt: '2026-06-21T00:00:00Z',
      // legacy/extra keys are ignored by the projection
      cursor: 'legacy',
      backfillComplete: true,
    }
    expect(syncStateFromStream(state)).toEqual({
      phase: 'steady',
      cursor: { kind: 'token', value: 'pg_2' },
      watermark: '2026-06-22T00:00:00Z',
      recordsSeen: 4200,
      backfillStartedAt: '2026-06-21T00:00:00Z',
    })
  })
})

describe('applySyncStateToStream', () => {
  it('overwrites only the core-owned fields and preserves legacy/extra keys', () => {
    const prev: ConnectorStreamState = {
      cursor: 'legacy-incremental',
      backfillComplete: true,
      customConnectorKey: 'keep-me',
    }
    const sync: SyncState = {
      phase: 'backfill',
      cursor: { kind: 'pageNumber', value: '3' },
      watermark: 'w1',
      recordsSeen: 10,
      backfillStartedAt: '2026-06-22T00:00:00Z',
    }
    expect(applySyncStateToStream(prev, sync)).toEqual({
      cursor: 'legacy-incremental',
      backfillComplete: true,
      customConnectorKey: 'keep-me',
      phase: 'backfill',
      backfillCursor: { kind: 'pageNumber', value: '3' },
      watermark: 'w1',
      recordsSeen: 10,
      backfillStartedAt: '2026-06-22T00:00:00Z',
    })
  })

  it('round-trips the core fields (H6 — cursor kind survives)', () => {
    const persisted: ConnectorStreamState = {
      phase: 'steady',
      backfillCursor: { kind: 'historyId', value: '99887766' },
      watermark: 'w9',
      recordsSeen: 5,
      cursor: 'legacy',
    }
    const roundTripped = applySyncStateToStream(persisted, syncStateFromStream(persisted))
    expect(roundTripped.backfillCursor).toEqual({ kind: 'historyId', value: '99887766' })
    expect(roundTripped.phase).toBe('steady')
    expect(roundTripped.cursor).toBe('legacy') // legacy key untouched
  })
})

// ── Run status fold ──────────────────────────────────────────────────────────────
// `457559483` ("a skipped record no longer marks the run partial") is what makes the
// v11 record filter usable at all: a stream that filters out every record must report
// `completed`, not `partial`. The whole feature rests on it, so pin it here rather
// than trusting a read of `finalize`.

/** Minimal fake Database: one `DataConnectorRun` row in, the `set` payload out. */
function fakeDb(row: { failed: number; errorSample: SyncRunErrorSample[] | null }) {
  const set = vi.fn(() => ({ where: async () => undefined }))
  const db = {
    query: { DataConnectorRun: { findFirst: async () => row } },
    update: () => ({ set }),
  } as unknown as Database
  return { db, set }
}

describe('ConnectorRunLedger.finalize — run status', () => {
  const run = { id: 'run1', startedAt: new Date(0) }

  it('a fully-FILTERED slice finalizes COMPLETED — skips are not failures', async () => {
    // What a filtering run looks like: everything fetched, everything skipped, nothing
    // written, and an empty errorSample (the sink never records a skip as an error).
    const { db, set } = fakeDb({ failed: 0, errorSample: null })
    await createConnectorRunLedger(db, run).finalize()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('a `skipped`-tier errorSample entry (the fail-open filter warning) stays COMPLETED', async () => {
    const { db, set } = fakeDb({
      failed: 0,
      errorSample: [{ externalId: '', error: 'Record filter ignored — …', tier: 'skipped' }],
    })
    await createConnectorRunLedger(db, run).finalize()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('a genuine pre-write drop still degrades the run to PARTIAL', async () => {
    const { db, set } = fakeDb({
      failed: 0,
      errorSample: [{ externalId: 'c1', error: 'unresolved field ref', tier: 'invalid' }],
    })
    await createConnectorRunLedger(db, run).finalize()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial' }))
  })
})
