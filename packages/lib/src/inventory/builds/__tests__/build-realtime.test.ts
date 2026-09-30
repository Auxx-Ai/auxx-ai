// packages/lib/src/inventory/builds/__tests__/build-realtime.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ published: [] as Array<Record<string, unknown>>, fail: false }))

vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishBuildChangedEvent: vi.fn(
    async (_s: unknown, _org: string, data: Record<string, unknown>) => {
      if (h.fail) throw new Error('pusher down')
      h.published.push(data)
    }
  ),
}))

import { publishBuildsChanged } from '../build-realtime'

const build = (n: number, overrides: Record<string, unknown> = {}) => ({
  buildId: `b_${n}`,
  partId: 'part_1',
  orderId: null,
  batchRun: null,
  ...overrides,
})

beforeEach(() => {
  h.published = []
  h.fail = false
})

describe('publishBuildsChanged', () => {
  it('sends one frame of distinct ids, dropping nulls', async () => {
    await publishBuildsChanged('org_1', [
      build(1, { orderId: 'ord_1', batchRun: 3 }),
      build(2, { partId: 'part_2', orderId: 'ord_1', batchRun: 3 }),
      build(3),
    ])
    expect(h.published).toEqual([
      {
        buildIds: ['b_1', 'b_2', 'b_3'],
        partIds: ['part_1', 'part_2'],
        orderIds: ['ord_1'],
        batchRuns: [3],
      },
    ])
  })

  it('splits a large run into frames of 500 builds', async () => {
    await publishBuildsChanged(
      'org_1',
      Array.from({ length: 1001 }, (_, i) => build(i))
    )
    expect(h.published.map((d) => (d.buildIds as string[]).length)).toEqual([500, 500, 1])
  })

  it('publishes nothing for no builds and never throws', async () => {
    await publishBuildsChanged('org_1', [])
    expect(h.published).toEqual([])
    h.fail = true
    await expect(publishBuildsChanged('org_1', [build(1)])).resolves.toBeUndefined()
  })
})
