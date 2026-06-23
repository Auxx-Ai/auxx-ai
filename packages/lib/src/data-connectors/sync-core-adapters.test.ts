// packages/lib/src/data-connectors/sync-core-adapters.test.ts

import { describe, expect, it } from 'vitest'
import type { SyncState } from '../sync-core/contracts'
import { applySyncStateToStream, syncStateFromStream } from './sync-core-adapters'
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
