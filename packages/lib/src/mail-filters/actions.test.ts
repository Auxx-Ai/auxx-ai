// packages/lib/src/mail-filters/actions.test.ts
// The executor's ONE divergence between the live path and the backfill (D18):
// a `retroactive` run refuses `run-agent` / `run-workflow`.
//
// Why this is worth a test file of its own: the backfill pages up to
// RETROACTIVE_MAX_THREADS threads through this exact function. If the check ever
// regresses, the failure mode is an agent replying to five thousand months-old
// customer threads — unattended, non-idempotent (§4.3) and not covered by the
// undo blob. So both halves are pinned: the escape hatches are skipped WITH A
// REASON on a retroactive run, and they still enqueue normally on a live one.
//
// Partial mocks only for the shared modules (the lib-test collection rule);
// domain modules the executor lazy-imports are replaced outright, which is the
// same shape `engine.test.ts` uses.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailFilterAction } from './types'

const h = vi.hoisted(() => ({
  add: vi.fn(),
  getQueue: vi.fn(),
  update: vi.fn(),
  loadMessage: vi.fn(),
  byAppId: vi.fn(),
}))

vi.mock('../jobs/queues', () => ({ getQueue: h.getQueue }))
vi.mock('../jobs/queues/types', () => ({
  Queues: { scheduledTriggerQueue: 'scheduled', workflowDelayQueue: 'workflow-delay' },
}))
vi.mock('../threads/thread-mutation.service', () => ({
  ThreadMutationService: class {
    update(...args: unknown[]) {
      return h.update(...args)
    }
  },
}))
vi.mock('../cache', () => ({
  getOrgCache: () => ({ from: () => ({ byAppId: h.byAppId }) }),
}))
vi.mock('../workflow-engine/nodes/trigger-nodes/message-loader', () => ({
  loadProcessedMessage: h.loadMessage,
}))

import {
  executeMailFilterAction,
  isRetroactiveSkippedAction,
  RETROACTIVE_SKIP_REASON,
  RETROACTIVE_SKIPPED_ACTION_TYPES,
} from './actions'

const RUN_AGENT: MailFilterAction = { type: 'run-agent', agentId: 'agt_1', agentTriggerId: 'trg_1' }
const RUN_WORKFLOW: MailFilterAction = { type: 'run-workflow', workflowAppId: 'wfa_1' }

function ctx(source: 'live' | 'retroactive') {
  return {
    db: {} as never,
    organizationId: 'org_1',
    threadId: 'thr_1',
    messageId: 'msg_1',
    filter: {
      id: 'flt_1',
      inboxId: 'ibx_1',
      name: 'Newsletters',
      order: 0,
      stopProcessing: false,
      enabled: true,
      conditions: [],
      actions: [],
      templateKey: null,
    },
    thread: { inboxId: 'ibx_1', status: 'OPEN', assigneeId: null },
    inbox: { id: 'ibx_1', isPersonal: false, ownerUserId: null },
    source,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getQueue.mockReturnValue({ add: h.add })
  h.add.mockResolvedValue(undefined)
  h.update.mockResolvedValue(undefined)
  h.byAppId.mockResolvedValue({ id: 'wfa_1', publishedWorkflow: { id: 'wf_1' } })
  h.loadMessage.mockResolvedValue({ id: 'msg_1' })
})

describe('a RETROACTIVE run never starts an agent or a workflow (D18)', () => {
  it.each([
    ['run-agent', RUN_AGENT],
    ['run-workflow', RUN_WORKFLOW],
  ])('skips %s with a reason, and enqueues nothing', async (_label, action) => {
    const result = await executeMailFilterAction(action, ctx('retroactive'))

    // A `skipped` outcome with a reason is what lands on the MailFilterRun row —
    // the author sees WHY the backfill did not run their agent, rather than an
    // uncaptioned status or (worse) nothing at all.
    expect(result).toEqual({ status: 'skipped', reason: RETROACTIVE_SKIP_REASON })
    expect(h.getQueue).not.toHaveBeenCalled()
    expect(h.add).not.toHaveBeenCalled()
  })

  it('does not even look the workflow up — the refusal precedes every side effect', async () => {
    await executeMailFilterAction(RUN_WORKFLOW, ctx('retroactive'))
    expect(h.byAppId).not.toHaveBeenCalled()
    expect(h.loadMessage).not.toHaveBeenCalled()
  })

  it('still runs the mail actions — only the escape hatches are withheld', async () => {
    const result = await executeMailFilterAction(
      { type: 'set-status', status: 'ARCHIVED' },
      ctx('retroactive')
    )

    expect(result).toEqual({ status: 'ok' })
    expect(h.update).toHaveBeenCalledTimes(1)
  })
})

describe('the LIVE path is unchanged', () => {
  it('enqueues run-agent on the scheduled-trigger queue', async () => {
    const result = await executeMailFilterAction(RUN_AGENT, ctx('live'))

    expect(result).toEqual({ status: 'ok' })
    expect(h.getQueue).toHaveBeenCalledWith('scheduled')
    expect(h.add).toHaveBeenCalledTimes(1)
    expect(h.add.mock.calls[0]?.[0]).toBe('executeAgentEventTrigger')
    expect(h.add.mock.calls[0]?.[1]).toMatchObject({
      agentId: 'agt_1',
      agentTriggerId: 'trg_1',
      organizationId: 'org_1',
    })
  })

  it('enqueues run-workflow on the workflow-delay queue', async () => {
    const result = await executeMailFilterAction(RUN_WORKFLOW, ctx('live'))

    expect(result).toEqual({ status: 'ok' })
    expect(h.getQueue).toHaveBeenCalledWith('workflow-delay')
    expect(h.add.mock.calls[0]?.[0]).toBe('executeMessageTrigger')
    expect(h.add.mock.calls[0]?.[1]).toMatchObject({ workflowAppId: 'wfa_1', workflowId: 'wf_1' })
  })
})

describe('assign is USERS ONLY — Thread.assigneeId FKs User.id', () => {
  it('assigns a bare user id (normalised to an ActorId)', async () => {
    const result = await executeMailFilterAction(
      { type: 'assign', assigneeId: 'usr_1' },
      ctx('live')
    )

    expect(result).toEqual({ status: 'ok' })
    expect(h.update.mock.calls[0]?.[1]).toEqual({ assigneeId: 'user:usr_1' })
  })

  it('skips a group assignee rather than writing an FK violation', async () => {
    // `ThreadMutationService.update` writes `parseActorId(...).id` straight into
    // `Thread.assigneeId`, which references `User.id` — there is no group
    // expansion anywhere on that path, so a group id is a 23503, not an assignment.
    const result = await executeMailFilterAction(
      { type: 'assign', assigneeId: 'group:grp_1' },
      ctx('live')
    )

    expect(result).toMatchObject({ status: 'skipped' })
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('RETROACTIVE_SKIPPED_ACTION_TYPES', () => {
  it('is exactly the two non-idempotent escape hatches', () => {
    expect([...RETROACTIVE_SKIPPED_ACTION_TYPES].sort()).toEqual(['run-agent', 'run-workflow'])
    expect(isRetroactiveSkippedAction('run-agent')).toBe(true)
    expect(isRetroactiveSkippedAction('set-status')).toBe(false)
  })
})
