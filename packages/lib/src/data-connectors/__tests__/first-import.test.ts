// packages/lib/src/data-connectors/__tests__/first-import.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loaded: null as unknown,
  runProgress: null as unknown,
  runWhere: vi.fn(),
}))

vi.mock('../service', () => ({ loadConnector: vi.fn(async () => h.loaded) }))

import { isFirstImport, readIsFirstImport } from '../first-import'

const db = {
  select: () => ({
    from: () => ({
      where: (w: unknown) => {
        h.runWhere(w)
        return {
          orderBy: () => ({
            limit: async () => (h.runProgress ? [{ progress: h.runProgress }] : []),
          }),
        }
      },
    }),
  }),
} as never

function loaded(status: string, phases: Array<'backfill' | 'steady' | undefined>) {
  return {
    connector: { id: 'conn_1', status, lastSyncedAt: new Date() },
    streams: phases.map((phase, i) => ({
      stream: { id: `s${i}`, state: phase ? { phase } : null },
      mappings: [{}],
    })),
  }
}

beforeEach(() => {
  h.loaded = null
  h.runProgress = null
  h.runWhere.mockClear()
})

describe('isFirstImport', () => {
  it('is not a first import once every stream is steady', () => {
    expect(
      isFirstImport({
        pausedReason: null,
        streamStates: [{ phase: 'steady' }, { phase: 'steady' }],
      })
    ).toBe(false)
  })

  it('is a first import while any stream never finished its backfill', () => {
    expect(isFirstImport({ pausedReason: null, streamStates: [{ phase: 'steady' }, {}] })).toBe(
      true
    )
    expect(
      isFirstImport({
        pausedReason: null,
        streamStates: [{ phase: 'backfill' }, { phase: 'steady' }],
      })
    ).toBe(true)
  })

  it('is not a first import while a stream that backfilled before re-crawls', () => {
    expect(
      isFirstImport({
        pausedReason: null,
        streamStates: [{ phase: 'backfill', backfilledBefore: true }, { phase: 'steady' }],
      })
    ).toBe(false)
  })

  it('is a first import when parked at a sample or the ingest ceiling, not a manual pause', () => {
    const steady = [{ phase: 'steady' as const }]
    expect(isFirstImport({ pausedReason: 'sample', streamStates: steady })).toBe(true)
    expect(isFirstImport({ pausedReason: 'ingest-ceiling', streamStates: steady })).toBe(true)
    expect(isFirstImport({ pausedReason: 'manual', streamStates: steady })).toBe(false)
  })
})

describe('readIsFirstImport', () => {
  it('gates "Sync everything" after a sample even though lastSyncedAt is stamped', async () => {
    h.loaded = loaded('paused', ['backfill', 'steady'])
    h.runProgress = { paused: { reason: 'sample' } }
    await expect(readIsFirstImport(db, 'org_1', 'conn_1')).resolves.toBe(true)
  })

  it('gates the retry of a failed partial first sync', async () => {
    h.loaded = loaded('error', ['backfill'])
    await expect(readIsFirstImport(db, 'org_1', 'conn_1')).resolves.toBe(true)
    expect(h.runWhere).not.toHaveBeenCalled()
  })

  it('lets a manual sync of a live, fully backfilled connector run', async () => {
    h.loaded = loaded('live', ['steady', 'steady'])
    await expect(readIsFirstImport(db, 'org_1', 'conn_1')).resolves.toBe(false)
  })

  it('reads the latest run pause reason only for a paused connector', async () => {
    h.loaded = loaded('paused', ['steady'])
    h.runProgress = { paused: { reason: 'manual' } }
    await expect(readIsFirstImport(db, 'org_1', 'conn_1')).resolves.toBe(false)
    expect(h.runWhere).toHaveBeenCalledTimes(1)
  })

  it('is false for a connector that does not exist in the org', async () => {
    await expect(readIsFirstImport(db, 'org_1', 'conn_x')).resolves.toBe(false)
  })
})
