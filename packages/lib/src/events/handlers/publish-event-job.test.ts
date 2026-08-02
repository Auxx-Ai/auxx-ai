// packages/lib/src/events/handlers/publish-event-job.test.ts
// The gate (plan §3). The property under test is FAIL-OPEN: a gate that throws
// or hangs must enqueue the FULL `then` list, because a broken mail filter must
// never be able to stop the timeline, bounce ingestion or workflows.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  addBulk: vi.fn(),
  applyMailFilters: vi.fn(),
}))

// PARTIAL mock — `Queues` is read at module scope by several importers
// (`agents/agent-trigger-service.ts`), so a full replacement dies at collection.
vi.mock('../../jobs/queues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getQueue: () => ({ addBulk: h.addBulk }),
}))
vi.mock('./apply-mail-filters', () => ({ applyMailFilters: h.applyMailFilters }))

import { publishEventJob } from './publish-event-job'

/** Handler job names from the single `addBulk` call. */
function enqueuedNames(): string[] {
  return (h.addBulk.mock.calls[0]?.[0] ?? []).map((job: { name: string }) => job.name)
}

const MESSAGE_RECEIVED = {
  data: {
    type: 'message:received',
    data: { messageId: 'msg_1', organizationId: 'org_1', threadId: 'thr_1' },
  },
} as never

const ALL_MESSAGE_HANDLERS = [
  'createTimelineEvent',
  'triggerMessageWorkflows',
  'deriveMessageReplySignal',
  'ingestBounceMessage',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.addBulk.mockResolvedValue(undefined)
  h.applyMailFilters.mockResolvedValue(undefined)
})

describe('publishEventJob — ungated entries', () => {
  it('is byte-identical to the pre-gate behaviour for a plain array', async () => {
    await publishEventJob({
      data: { type: 'message:sent', data: { messageId: 'm', organizationId: 'o' } },
    } as never)

    expect(enqueuedNames()).toEqual(['createTimelineEvent'])
  })

  it('enqueues nothing for an event type with an empty handler list', async () => {
    await publishEventJob({
      data: { type: 'message:failed', data: { messageId: 'm', organizationId: 'o' } },
    } as never)

    expect(h.addBulk).not.toHaveBeenCalled()
  })

  it('never calls the gate for an ungated event type', async () => {
    await publishEventJob({
      data: { type: 'message:sent', data: { messageId: 'm', organizationId: 'o' } },
    } as never)

    expect(h.applyMailFilters).not.toHaveBeenCalled()
  })
})

describe('publishEventJob — gated entries', () => {
  it('enqueues the full `then` list when the gate suppresses nothing', async () => {
    await publishEventJob(MESSAGE_RECEIVED)

    expect(h.applyMailFilters).toHaveBeenCalledTimes(1)
    expect(enqueuedNames()).toEqual(ALL_MESSAGE_HANDLERS)
  })

  it('drops exactly the named handlers and nothing else', async () => {
    h.applyMailFilters.mockResolvedValue({ suppress: ['triggerMessageWorkflows'] })

    await publishEventJob(MESSAGE_RECEIVED)

    expect(enqueuedNames()).toEqual([
      'createTimelineEvent',
      'deriveMessageReplySignal',
      'ingestBounceMessage',
    ])
  })

  it('ignores suppress names that are not in this entry’s `then` list', async () => {
    h.applyMailFilters.mockResolvedValue({ suppress: ['triggerAgents', 'notAHandler'] })

    await publishEventJob(MESSAGE_RECEIVED)

    expect(enqueuedNames()).toEqual(ALL_MESSAGE_HANDLERS)
  })

  it('FAILS OPEN when the gate throws — the full list is still enqueued', async () => {
    h.applyMailFilters.mockRejectedValue(new Error('filter engine exploded'))

    await publishEventJob(MESSAGE_RECEIVED)

    expect(enqueuedNames()).toEqual(ALL_MESSAGE_HANDLERS)
  })

  it('FAILS OPEN when the gate hangs past the timeout', async () => {
    vi.useFakeTimers()
    try {
      // Never settles — the `Promise.race` timeout is the only thing that can
      // release the fan-out.
      h.applyMailFilters.mockImplementation(() => new Promise(() => {}))

      const running = publishEventJob(MESSAGE_RECEIVED)
      await vi.advanceTimersByTimeAsync(2500)
      await running

      expect(enqueuedNames()).toEqual(ALL_MESSAGE_HANDLERS)
    } finally {
      vi.useRealTimers()
    }
  })
})
