// packages/lib/src/data-connectors/touch-item.test.ts
// `touchItem` is the seen-alive stamp the sink's unchanged-content fast path and the
// out-of-order guard both take. Before v12.1 Phase 1 it stamped only `lastSeenRunId`, so
// a `mark_deleted` flag or a connector archive only healed when the record's content
// also changed. Every sink test mocks `touchItem`, which is why that was missed; this
// runs the real function against a drizzle chain double and pins the update payload.

import { describe, expect, it, vi } from 'vitest'
import { touchItem } from './service'

function mockDb() {
  const sets: Array<Record<string, unknown>> = []
  const where = vi.fn(async () => {})
  const set = vi.fn((payload: Record<string, unknown>) => {
    sets.push(payload)
    return { where }
  })
  const update = vi.fn(() => ({ set }))
  return { db: { update } as never, sets, where }
}

describe('touchItem', () => {
  it('clears removedUpstreamAt and archivedAt alongside the seen stamp', async () => {
    const { db, sets, where } = mockDb()

    await touchItem(db, 'item1', 'run2')

    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({
      lastSeenRunId: 'run2',
      removedUpstreamAt: null,
      archivedAt: null,
    })
    expect(sets[0]?.lastSyncedAt).toBeInstanceOf(Date)
    // A no-op content update leaves the stored version stamp alone.
    expect(sets[0]).not.toHaveProperty('upstreamUpdatedAt')
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('advances upstreamUpdatedAt when a newer stamp is supplied, still clearing both', async () => {
    const { db, sets } = mockDb()
    const stamp = new Date('2026-06-22T00:00:00Z')

    await touchItem(db, 'item1', 'run2', stamp)

    expect(sets[0]).toMatchObject({
      lastSeenRunId: 'run2',
      upstreamUpdatedAt: stamp,
      removedUpstreamAt: null,
      archivedAt: null,
    })
  })
})
