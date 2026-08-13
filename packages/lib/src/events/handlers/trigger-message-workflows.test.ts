// packages/lib/src/events/handlers/trigger-message-workflows.test.ts
//
// message-trigger-scoping plan §4 — the dispatcher channel gate.
// `matchesChannelScope` reads `channelIds` off the published trigger node and
// filters BEFORE `loadProcessedMessage`/enqueue, so a non-matching message
// costs zero queries. This file pins: unscoped workflows still fire on every
// channel (no forced migration), a scoped workflow fires only for its
// channels, and the existing machineMail gating keeps working alongside it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getCachedWorkflowAppsByTrigger: vi.fn(),
  getQueueAdd: vi.fn(),
  loadProcessedMessage: vi.fn(),
  orgCacheGet: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getCachedWorkflowAppsByTrigger: h.getCachedWorkflowAppsByTrigger,
  getOrgCache: () => ({ get: h.orgCacheGet }),
}))
vi.mock('../../jobs/queues', () => ({
  getQueue: () => ({ add: h.getQueueAdd }),
}))
vi.mock('../../workflow-engine/nodes/trigger-nodes/message-loader', () => ({
  loadProcessedMessage: h.loadProcessedMessage,
}))

import { triggerMessageWorkflows } from './trigger-message-workflows'

const ORG = 'org_1'
const MESSAGE_ID = 'msg_1'
const THREAD_ID = 'thr_1'
const INT_A = 'int_a'
const INT_B = 'int_b'

/** A published workflow app with a MESSAGE_RECEIVED trigger node, optionally channel-scoped. */
function app(
  id: string,
  overrides: {
    channelIds?: string[]
    machineMail?: 'include' | 'exclude'
    ownAddress?: 'include' | 'exclude'
  } = {}
) {
  return {
    id: `app_${id}`,
    publishedWorkflow: {
      id: `wf_${id}`,
      createdById: null,
      graph: {
        nodes: [
          {
            type: 'message-received',
            data: {
              type: 'message-received',
              ...(overrides.channelIds !== undefined && { channelIds: overrides.channelIds }),
              ...(overrides.machineMail !== undefined && { machineMail: overrides.machineMail }),
              ...(overrides.ownAddress !== undefined && { ownAddress: overrides.ownAddress }),
            },
          },
        ],
      },
    },
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'message:received',
      data: {
        messageId: MESSAGE_ID,
        organizationId: ORG,
        threadId: THREAD_ID,
        integrationId: INT_A,
        ...overrides,
      },
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadProcessedMessage.mockResolvedValue({ id: MESSAGE_ID })
  h.orgCacheGet.mockResolvedValue([])
})

describe('triggerMessageWorkflows — channel scope (§4)', () => {
  it('dispatches an unscoped workflow (no channelIds) regardless of the message channel', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('unscoped')])

    await triggerMessageWorkflows(event({ integrationId: INT_B }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
    expect(h.getQueueAdd).toHaveBeenCalledWith(
      'executeMessageTrigger',
      expect.objectContaining({ workflowAppId: 'app_unscoped' })
    )
  })

  it('dispatches a workflow whose empty channelIds array also means "all channels"', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('empty-scope', { channelIds: [] })])

    await triggerMessageWorkflows(event({ integrationId: INT_B }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('dispatches a scoped workflow when the message channel is in scope', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('scoped', { channelIds: [INT_A, INT_B] }),
    ])

    await triggerMessageWorkflows(event({ integrationId: INT_A }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('skips a scoped workflow when the message channel is NOT in scope', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('scoped', { channelIds: [INT_B] })])

    await triggerMessageWorkflows(event({ integrationId: INT_A }))

    expect(h.getQueueAdd).not.toHaveBeenCalled()
    expect(h.loadProcessedMessage).not.toHaveBeenCalled()
  })

  it('dispatches only the matching workflow out of a mixed set', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('scoped-a', { channelIds: [INT_A] }),
      app('scoped-b', { channelIds: [INT_B] }),
      app('unscoped'),
    ])

    await triggerMessageWorkflows(event({ integrationId: INT_A }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(2)
    const dispatched = h.getQueueAdd.mock.calls.map((call) => call[1].workflowAppId)
    expect(dispatched.sort()).toEqual(['app_scoped-a', 'app_unscoped'])
  })

  it('treats a missing integrationId as out of scope for a channel-restricted workflow', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('scoped', { channelIds: [INT_A] })])

    await triggerMessageWorkflows(event({ integrationId: undefined }))

    expect(h.getQueueAdd).not.toHaveBeenCalled()
  })

  it('never dispatches for a message on a personal channel, even to unscoped workflows', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('unscoped')])
    h.orgCacheGet.mockResolvedValue([{ id: 'ibx_personal', isPersonal: true }])

    await triggerMessageWorkflows(event({ inboxId: 'ibx_personal' }))

    expect(h.getQueueAdd).not.toHaveBeenCalled()
    expect(h.loadProcessedMessage).not.toHaveBeenCalled()
  })

  it('dispatches normally for a message on a shared inbox', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('unscoped')])
    h.orgCacheGet.mockResolvedValue([{ id: 'ibx_shared', isPersonal: false }])

    await triggerMessageWorkflows(event({ inboxId: 'ibx_shared' }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('applies channel scope alongside the existing soft machine-mail gate', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('scoped-opted-in', { channelIds: [INT_A], machineMail: 'include' }),
      app('scoped-not-opted-in', { channelIds: [INT_A] }),
    ])

    await triggerMessageWorkflows(
      event({ integrationId: INT_A, machineMail: { tier: 'soft', reason: 'no-reply' } })
    )

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
    expect(h.getQueueAdd).toHaveBeenCalledWith(
      'executeMessageTrigger',
      expect.objectContaining({ workflowAppId: 'app_scoped-opted-in' })
    )
  })
})

// The loop guards moved off the publish site and onto the dispatcher: ingest
// now always publishes and attaches signals, so this handler is where a loop
// actually stops. `ownEcho` is hard (proof the message is a copy of one we
// sent); `fromOwnAddress` is the author's call and defaults to firing.
describe('triggerMessageWorkflows — loop signals', () => {
  it('never dispatches for a proven echo of our own sent mail', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('unscoped')])

    await triggerMessageWorkflows(event({ ownEcho: { sentMessageId: 'm_sent_1' } }))

    expect(h.getQueueAdd).not.toHaveBeenCalled()
    expect(h.loadProcessedMessage).not.toHaveBeenCalled()
  })

  it('skips an echo even for a workflow that opted into own-address mail', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('opted-in', { ownAddress: 'include' })])

    await triggerMessageWorkflows(
      event({ ownEcho: { sentMessageId: 'm_sent_1' }, fromOwnAddress: true })
    )

    expect(h.getQueueAdd).not.toHaveBeenCalled()
  })

  it('dispatches own-address mail by default — a teammate writing in is real mail', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('unscoped')])

    await triggerMessageWorkflows(event({ fromOwnAddress: true }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
    expect(h.getQueueAdd).toHaveBeenCalledWith(
      'executeMessageTrigger',
      expect.objectContaining({ workflowAppId: 'app_unscoped' })
    )
  })

  it("dispatches own-address mail for a trigger with an explicit 'include'", async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([app('opted-in', { ownAddress: 'include' })])

    await triggerMessageWorkflows(event({ fromOwnAddress: true }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("skips a trigger that opted out with ownAddress: 'exclude'", async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('opted-out', { ownAddress: 'exclude' }),
    ])

    await triggerMessageWorkflows(event({ fromOwnAddress: true }))

    expect(h.getQueueAdd).not.toHaveBeenCalled()
    expect(h.loadProcessedMessage).not.toHaveBeenCalled()
  })

  it("still dispatches an 'exclude' trigger for mail that is NOT own-address", async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('opted-out', { ownAddress: 'exclude' }),
    ])

    await triggerMessageWorkflows(event())

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('filters per workflow — one opted out, one on the default', async () => {
    h.getCachedWorkflowAppsByTrigger.mockResolvedValue([
      app('opted-out', { ownAddress: 'exclude' }),
      app('default'),
    ])

    await triggerMessageWorkflows(event({ fromOwnAddress: true }))

    expect(h.getQueueAdd).toHaveBeenCalledTimes(1)
    expect(h.getQueueAdd).toHaveBeenCalledWith(
      'executeMessageTrigger',
      expect.objectContaining({ workflowAppId: 'app_default' })
    )
  })
})
