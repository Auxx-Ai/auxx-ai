// packages/lib/src/data-connectors/__tests__/run-control.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRunHeartbeat } from '../run-control'

function fakeDb() {
  const where = vi.fn(() => Promise.resolve([]))
  const set = vi.fn((_values: unknown) => ({ where }))
  const update = vi.fn(() => ({ set }))
  return { db: { update } as never, update, set, where }
}

describe('startRunHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('bumps heartbeatAt on the interval and stops when told to', async () => {
    const { db, update, set } = fakeDb()
    const stop = startRunHeartbeat(db, 'run_1', 1_000)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(update).toHaveBeenCalledTimes(3)
    expect(set.mock.calls[0]?.[0]).toMatchObject({ heartbeatAt: expect.any(Date) })

    stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('swallows a failed beat so the pass it guards is never disturbed', async () => {
    const where = vi.fn(() => Promise.reject(new Error('db down')))
    const db = { update: () => ({ set: () => ({ where }) }) } as never
    const stop = startRunHeartbeat(db, 'run_1', 1_000)

    await vi.advanceTimersByTimeAsync(2_500)
    expect(where).toHaveBeenCalledTimes(2)
    stop()
  })
})
