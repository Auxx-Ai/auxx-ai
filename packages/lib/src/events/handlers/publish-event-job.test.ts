// packages/lib/src/events/handlers/publish-event-job.test.ts
// The gate (plan §3). The property under test is FAIL-OPEN: a gate that throws
// or hangs must enqueue the FULL `then` list, because a broken mail filter must
// never be able to stop the timeline, bounce ingestion or workflows.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  addBulk: vi.fn(),
  applyMailFilters: vi.fn(),
  persistEvent: vi.fn(),
  captureAnalytics: vi.fn(),
}))

// PARTIAL mock — `Queues` is read at module scope by several importers
// (`agents/agent-trigger-service.ts`), so a full replacement dies at collection.
vi.mock('../../jobs/queues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getQueue: () => ({ addBulk: h.addBulk }),
}))
vi.mock('./apply-mail-filters', () => ({ applyMailFilters: h.applyMailFilters }))
vi.mock('./create-event-job', () => ({
  persistEvent: h.persistEvent,
  createEventJob: vi.fn(),
}))
// PARTIAL mock: `isAnalyticsEvent` is tested for real below; only the PostHog
// capture is stubbed.
vi.mock('./publish-to-analytics-job', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureAnalytics: h.captureAnalytics,
}))

import { isWebhookEvent } from '../../jobs/webhooks/webhook-events'
import { publishEventJob } from './publish-event-job'
import { isAnalyticsEvent } from './publish-to-analytics-job'

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
  // AI categorisation (mail-classification plan §4). Deliberately NOT in the
  // gate — see the comment on the `then` list — and deliberately NOT in
  // `SUPPRESSIBLE_AUTOMATION_HANDLERS`, so `suppress-automations` does not
  // switch it off.
  'enqueueMailClassification',
]

beforeEach(() => {
  vi.clearAllMocks()
  h.addBulk.mockResolvedValue(undefined)
  h.applyMailFilters.mockResolvedValue(undefined)
  h.persistEvent.mockResolvedValue(undefined)
  h.captureAnalytics.mockReturnValue(undefined)
})

describe('publishEventJob — inline persist + analytics', () => {
  const MESSAGE_SENT_EVENT = {
    type: 'message:sent',
    data: { messageId: 'm', organizationId: 'o' },
  } as never
  const MESSAGE_SENT = { data: MESSAGE_SENT_EVENT }

  it('persists the Event row, then captures analytics, then fans out', async () => {
    const order: string[] = []
    h.persistEvent.mockImplementation(async () => {
      order.push('persist')
    })
    h.captureAnalytics.mockImplementation(() => {
      order.push('analytics')
    })
    h.addBulk.mockImplementation(async () => {
      order.push('fanOut')
    })

    await publishEventJob(MESSAGE_SENT)

    expect(h.persistEvent).toHaveBeenCalledWith(MESSAGE_SENT_EVENT)
    expect(h.captureAnalytics).toHaveBeenCalledWith(MESSAGE_SENT_EVENT)
    expect(order).toEqual(['persist', 'analytics', 'fanOut'])
  })

  it('still persists and captures for an event type with no handlers', async () => {
    await publishEventJob({
      data: { type: 'message:failed', data: { messageId: 'm', organizationId: 'o' } },
    } as never)

    expect(h.persistEvent).toHaveBeenCalledTimes(1)
    expect(h.captureAnalytics).toHaveBeenCalledTimes(1)
    expect(h.addBulk).not.toHaveBeenCalled()
  })

  it('still fans out when the Event insert fails', async () => {
    h.persistEvent.mockRejectedValue(new Error('insert exploded'))

    await expect(publishEventJob(MESSAGE_SENT)).resolves.toBeUndefined()

    expect(enqueuedNames()).toEqual(['createTimelineEvent', 'flipDocumentStatusOnSend'])
  })

  it('still fans out when the analytics capture throws', async () => {
    h.captureAnalytics.mockImplementation(() => {
      throw new Error('posthog exploded')
    })

    await expect(publishEventJob(MESSAGE_SENT)).resolves.toBeUndefined()

    expect(enqueuedNames()).toEqual(['createTimelineEvent', 'flipDocumentStatusOnSend'])
  })

  it('still fails the job when the handler enqueue fails, so BullMQ retries', async () => {
    h.addBulk.mockRejectedValue(new Error('redis down'))

    await expect(publishEventJob(MESSAGE_SENT)).rejects.toThrow('redis down')
  })
})

describe('isAnalyticsEvent', () => {
  it('rejects per-field edits and the field-hook fan-out', () => {
    expect(isAnalyticsEvent('contact:field:updated')).toBe(false)
    expect(isAnalyticsEvent('entity:field:updated')).toBe(false)
    expect(isAnalyticsEvent('field:trigger')).toBe(false)
  })

  it('accepts product events', () => {
    expect(isAnalyticsEvent('contact:created')).toBe(true)
    expect(isAnalyticsEvent('message:received')).toBe(true)
  })
})

describe('isWebhookEvent', () => {
  it('answers from WEBHOOK_EVENTS', () => {
    expect(isWebhookEvent('ticket:created')).toBe(true)
    expect(isWebhookEvent('message:received')).toBe(true)
    expect(isWebhookEvent('contact:field:updated')).toBe(false)
    expect(isWebhookEvent('field:trigger')).toBe(false)
    expect(isWebhookEvent('not:an:event')).toBe(false)
  })
})

describe('publishEventJob — ungated entries', () => {
  it('is byte-identical to the pre-gate behaviour for a plain array', async () => {
    await publishEventJob({
      data: { type: 'message:sent', data: { messageId: 'm', organizationId: 'o' } },
    } as never)

    expect(enqueuedNames()).toEqual(['createTimelineEvent', 'flipDocumentStatusOnSend'])
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
      'enqueueMailClassification',
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
