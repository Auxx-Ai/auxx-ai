// packages/lib/src/events/publisher.test.ts
// `publishLater` enqueues ONE `publishEventJob` on the events queue per event,
// and a `processWebhookJob` on the webhooks queue only for types a webhook can
// subscribe to. It never throws: callers fire-and-forget.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  eventsAdd: vi.fn(),
  webhooksAdd: vi.fn(),
}))

// PARTIAL mock — `Queues` is read at module scope by several importers, so a
// full replacement dies at collection. `getQueue` answers per queue name.
vi.mock('../jobs/queues', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getQueue: (name: string) => ({
    add: name === 'webhooks' ? h.webhooksAdd : h.eventsAdd,
  }),
}))

import { publisher } from './publisher'

const TICKET_CREATED = {
  type: 'ticket:created',
  data: { recordId: 'rec_1', organizationId: 'org_1', userId: 'usr_1', eventData: {} },
} as never

const FIELD_UPDATED = {
  type: 'contact:field:updated',
  data: { recordId: 'rec_1', organizationId: 'org_1', userId: 'usr_1' },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.eventsAdd.mockResolvedValue(undefined)
  h.webhooksAdd.mockResolvedValue(undefined)
})

describe('publisher.publishLater', () => {
  it('enqueues exactly one publishEventJob on the events queue for a webhook event', async () => {
    await publisher.publishLater(TICKET_CREATED)

    expect(h.eventsAdd).toHaveBeenCalledTimes(1)
    expect(h.eventsAdd).toHaveBeenCalledWith('publishEventJob', TICKET_CREATED)
    expect(h.webhooksAdd).toHaveBeenCalledTimes(1)
    expect(h.webhooksAdd).toHaveBeenCalledWith('processWebhookJob', TICKET_CREATED)
  })

  it('skips the webhooks queue for a type no webhook can subscribe to', async () => {
    await publisher.publishLater(FIELD_UPDATED)

    expect(h.eventsAdd).toHaveBeenCalledTimes(1)
    expect(h.eventsAdd).toHaveBeenCalledWith('publishEventJob', FIELD_UPDATED)
    expect(h.webhooksAdd).not.toHaveBeenCalled()
  })

  it('never throws when the enqueue fails', async () => {
    h.eventsAdd.mockRejectedValue(new Error('redis down'))

    await expect(publisher.publishLater(TICKET_CREATED)).resolves.toBeUndefined()
  })
})
