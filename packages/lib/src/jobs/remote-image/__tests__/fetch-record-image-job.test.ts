// packages/lib/src/jobs/remote-image/__tests__/fetch-record-image-job.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', () => ({ database: {} }))

const fetchRecordImage = vi.fn()
vi.mock('../../../files/remote-image/fetch-record-image', () => ({
  fetchRecordImage: (...a: unknown[]) => fetchRecordImage(...a),
}))
const enqueueRecordImageFetch = vi.fn()
vi.mock('../../../files/remote-image/enqueue', () => ({
  enqueueRecordImageFetch: (...a: unknown[]) => enqueueRecordImageFetch(...a),
}))

import { fetchRecordImageJob } from '../fetch-record-image-job'

const DATA = {
  organizationId: 'org1',
  entityDefinitionId: 'def',
  instanceId: 'inst1',
  fieldId: 'f1',
  url: 'https://x/1.jpg',
}
const ctx = { data: DATA, jobId: 'j1' } as never

beforeEach(() => vi.clearAllMocks())

describe('fetchRecordImageJob', () => {
  it('throws on a transient error so BullMQ retries', async () => {
    fetchRecordImage.mockResolvedValue(err(new Error('HTTP 503')))
    await expect(fetchRecordImageJob(ctx)).rejects.toThrow('HTTP 503')
  })

  it('does not throw on a permanent failure', async () => {
    fetchRecordImage.mockResolvedValue(ok({ outcome: 'failed', reason: 'HTTP 404' }))
    await expect(fetchRecordImageJob(ctx)).resolves.toBeUndefined()
    expect(enqueueRecordImageFetch).not.toHaveBeenCalled()
  })

  it('re-enqueues with a delay when over the per-org budget', async () => {
    fetchRecordImage.mockResolvedValue(ok({ outcome: 'deferred', retryInMs: 5000 }))
    await fetchRecordImageJob(ctx)
    expect(enqueueRecordImageFetch).toHaveBeenCalledWith(
      { ...DATA, deferrals: 1 },
      { delayMs: 5000 }
    )
  })
})
