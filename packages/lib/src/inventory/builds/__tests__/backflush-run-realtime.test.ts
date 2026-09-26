// packages/lib/src/inventory/builds/__tests__/backflush-run-realtime.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ published: [] as Array<Record<string, unknown>>, fail: false }))

vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishBackflushRunEvent: vi.fn(
    async (_s: unknown, _org: string, data: Record<string, unknown>) => {
      if (h.fail) throw new Error('pusher down')
      h.published.push(data)
    }
  ),
}))

import { publishBackflushRun } from '../backflush-run-realtime'

const frame = (kind: 'started' | 'progress' | 'finished', processed: number) => ({
  runId: 'run_1',
  kind,
  status: kind === 'finished' ? ('COMPLETED' as const) : ('IN_PROGRESS' as const),
  processed,
  total: 100,
  written: processed,
  failed: 0,
})

beforeEach(() => {
  h.published = []
  h.fail = false
  vi.useFakeTimers({ now: new Date('2026-09-25T12:00:00Z') })
})

describe('publishBackflushRun', () => {
  it('throttles progress per run but always sends the lifecycle edges', async () => {
    await publishBackflushRun('org_1', frame('started', 0))
    await publishBackflushRun('org_1', frame('progress', 10))
    await publishBackflushRun('org_1', frame('progress', 20))
    vi.advanceTimersByTime(800)
    await publishBackflushRun('org_1', frame('progress', 30))
    await publishBackflushRun('org_1', frame('finished', 100))
    expect(h.published.map((d) => [d.kind, d.processed])).toEqual([
      ['started', 0],
      ['progress', 10],
      ['progress', 30],
      ['finished', 100],
    ])
  })

  it('never throws into the run', async () => {
    h.fail = true
    await expect(publishBackflushRun('org_1', frame('finished', 1))).resolves.toBeUndefined()
  })
})
