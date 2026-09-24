// packages/lib/src/files/remote-image/__tests__/enqueue.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const add = vi.fn()
vi.mock('../../../jobs/queues', () => ({ getQueue: () => ({ add }) }))

import { enqueueRecordImageFetch } from '../enqueue'

const DATA = {
  organizationId: 'org1',
  entityDefinitionId: 'def',
  instanceId: 'inst1',
  fieldId: 'f1',
  url: 'https://cdn.example.com/a.jpg',
}

beforeEach(() => vi.clearAllMocks())

describe('enqueueRecordImageFetch', () => {
  it('keys the job on the URL hash, colon-free', async () => {
    await enqueueRecordImageFetch(DATA)
    await enqueueRecordImageFetch({ ...DATA, url: 'https://cdn.example.com/b.jpg' })

    const [first, second] = add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId)
    expect(first).toMatch(/^record-image-org1-inst1-f1-[0-9a-f]{16}$/)
    expect(first).not.toBe(second)
  })

  it('a deferred re-enqueue gets its own id and the delay', async () => {
    await enqueueRecordImageFetch({ ...DATA, deferrals: 2 }, { delayMs: 500 })

    expect(add.mock.calls[0]?.[2]).toMatchObject({
      jobId: expect.stringMatching(/-d2$/),
      delay: 500,
    })
  })

  it('never throws', async () => {
    add.mockRejectedValue(new Error('redis down'))
    await expect(enqueueRecordImageFetch(DATA)).resolves.toBe(false)
  })
})
