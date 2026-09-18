// packages/lib/src/accounting/mirror/__tests__/provider-sync-enqueue.test.ts
//
// §4.6.2. The enqueue is bounded because `add()` talks to Redis and ioredis
// retries a refused connection for ever - but unlike delivery's, a dropped job
// here is not recoverable: there is no sweep until §5's cadence exists, so a
// press whose enqueue was dropped did nothing at all. Hence the return value.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../errors'
import type { ProviderSyncRunRecord, ProviderSyncStateBlob } from '../client'
import { enqueueProviderSync, enqueueProviderSyncSlice, PROVIDER_SYNC_RUN_STALE_MS } from '../queue'

const add = vi.hoisted(() => vi.fn())
const stored = vi.hoisted(() => ({ blob: {} as ProviderSyncStateBlob }))

vi.mock('../../../jobs/queues', () => ({
  Queues: { providerSyncQueue: 'provider-sync' },
  getQueue: vi.fn(() => ({ add })),
}))

vi.mock('../run-state-io', () => ({
  loadProviderSyncBlob: vi.fn(async () => structuredClone(stored.blob)),
  saveProviderSyncBlob: vi.fn(),
}))

const ORG = 'org_1'

/** An open run whose last slice landed `silentMs` ago. */
function openRun(silentMs: number): ProviderSyncRunRecord {
  return {
    startedAt: new Date(Date.now() - silentMs - 60_000).toISOString(),
    heartbeatAt: new Date(Date.now() - silentMs).toISOString(),
    status: 'running',
    counters: {
      fetched: 4,
      created: 4,
      updated: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      failed: 0,
    },
    errorSample: [],
    pagesProcessed: 2,
    rateLimitWaitMs: 0,
  }
}

beforeEach(() => {
  add.mockReset()
  // BullMQ's own custom-id validation, verbatim from `Job.addJob`. Without it a
  // mocked `add` accepts an id the real queue rejects outright, and the refusal
  // only shows up as "could not be queued" in a browser.
  add.mockImplementation(async (_name: string, _data: unknown, opts?: { jobId?: string }) => {
    const id = opts?.jobId
    if (id?.includes(':') && id.split(':').length !== 3) {
      throw new Error('Custom Id cannot contain :')
    }
    return { id: id ?? 'job_1' }
  })
  stored.blob = {}
})

afterEach(() => {
  vi.useRealTimers()
})

describe('enqueueProviderSync', () => {
  it('collapses a second press onto the job already queued', async () => {
    const queued = await enqueueProviderSync({
      organizationId: ORG,
      to: '2026-09-16',
      trigger: 'pressed',
    })

    expect(queued).toBe(true)
    expect(add).toHaveBeenCalledWith(
      'provider-sync',
      expect.objectContaining({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' }),
      { jobId: `provider-sync-${ORG}` }
    )
    // The run's identity is stamped here, once, and every slice folds into it.
    expect(add.mock.calls[0]?.[1].runStartedAt).toEqual(expect.any(String))
  })

  // `provider-sync:<org>` reached dev and made every press answer "could not be
  // queued": BullMQ accepts a colon only in an id that splits into exactly
  // three, and a mocked `add` never ran that check. `beforeEach` now does.
  it('🛑 gives the job an id BullMQ will accept', async () => {
    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(true)
  })

  it('🛑 reports a refused queue instead of failing silently', async () => {
    add.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(false)
  })

  it('🛑 gives up on a queue that never answers, and says so', async () => {
    vi.useFakeTimers()
    add.mockReturnValueOnce(new Promise(() => {}))

    const pending = enqueueProviderSync({
      organizationId: ORG,
      to: '2026-09-16',
      trigger: 'pressed',
    })
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(pending).resolves.toBe(false)
  })
})

describe('the door is org-singular (§4.6.1)', () => {
  it('a fresh org enqueues', async () => {
    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(true)
  })

  it('🛑 refuses a second press while a run is open, and queues nothing', async () => {
    stored.blob = { currentRun: openRun(30_000) }

    const refusal = await enqueueProviderSync({
      organizationId: ORG,
      to: '2026-09-16',
      trigger: 'pressed',
    }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(ConflictError)
    expect((refusal as ConflictError).statusCode).toBe(409)
    // Names what is running and roughly how far it has got.
    expect((refusal as ConflictError).message).toContain('2 chunk(s)')
    // 🛑 A refusal is not a drop: nothing reached the queue.
    expect(add).not.toHaveBeenCalled()
  })

  it('a closed run is not an open one', async () => {
    stored.blob = { lastRun: { ...openRun(30_000), status: 'completed' } }

    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(true)
  })

  it('§7.4 takes over a run whose heartbeat has gone stale, rather than locking the org out', async () => {
    stored.blob = { currentRun: openRun(PROVIDER_SYNC_RUN_STALE_MS + 60_000) }

    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(true)
    // The takeover gets its own run identity; `recordSliceInBlob` files the
    // abandoned one under `lastRun`.
    expect(add.mock.calls[0]?.[1].runStartedAt).not.toBe(stored.blob.currentRun?.startedAt)
  })

  it('an unparseable heartbeat reads as stale, not as a permanent lock', async () => {
    stored.blob = { currentRun: { ...openRun(30_000), heartbeatAt: 'not a date' } }

    await expect(
      enqueueProviderSync({ organizationId: ORG, to: '2026-09-16', trigger: 'pressed' })
    ).resolves.toBe(true)
  })
})

describe('enqueueProviderSyncSlice', () => {
  it('🛑 is never refused - it IS the open run, continuing itself', async () => {
    stored.blob = { currentRun: openRun(1_000) }

    await expect(
      enqueueProviderSyncSlice({
        organizationId: ORG,
        to: '2026-09-16',
        trigger: 'pressed',
        runStartedAt: stored.blob.currentRun?.startedAt ?? '',
      })
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('🛑 carries no jobId - the running job still holds the press’s id', async () => {
    await enqueueProviderSyncSlice(
      {
        organizationId: ORG,
        to: '2026-09-16',
        trigger: 'pressed',
        runStartedAt: '2026-09-16T10:00:00.000Z',
      },
      { delayMs: 1_500 }
    )

    expect(add).toHaveBeenCalledWith('provider-sync', expect.anything(), {
      delay: 1_500,
      jobId: undefined,
    })
  })

  it('paces only when the slice asked for it', async () => {
    await enqueueProviderSyncSlice({
      organizationId: ORG,
      to: '2026-09-16',
      trigger: 'scheduled',
      runStartedAt: '2026-09-16T10:00:00.000Z',
    })

    expect(add).toHaveBeenCalledWith('provider-sync', expect.anything(), {
      delay: undefined,
      jobId: undefined,
    })
  })
})
