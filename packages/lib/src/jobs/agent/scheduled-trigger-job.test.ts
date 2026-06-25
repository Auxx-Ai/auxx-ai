// packages/lib/src/jobs/agent/scheduled-trigger-job.test.ts
// Regression guard: the handler builds `triggerContext.schedulerId` from
// `ctx.job.opts.repeatJobKey`. Reading `opts` off the context instead of the real job
// (`ctx.job`) used to throw "Cannot read properties of undefined (reading 'repeatJobKey')"
// on every scheduled fire. Deps faked so we can assert the scheduler id flows through.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCachedAgentById, createSession, enqueueAgentJob, buildTriggerSeedMessage } = vi.hoisted(
  () => ({
    getCachedAgentById: vi.fn(),
    createSession: vi.fn(),
    enqueueAgentJob: vi.fn(),
    buildTriggerSeedMessage: vi.fn(() => ({ role: 'user', content: 'go' })),
  })
)

vi.mock('../../cache', () => ({ getCachedAgentById }))
vi.mock('@auxx/services', () => ({ createSession }))
vi.mock('../../ai/agent-framework/enqueue-agent-job', () => ({ enqueueAgentJob }))
vi.mock('../../ai/agent-framework/trigger-seed-message', () => ({ buildTriggerSeedMessage }))
vi.mock('../../agents/agent-trigger-service', () => ({
  AgentTriggerService: class {
    removeScheduledScheduler = vi.fn()
  },
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}))

import { executeAgentScheduledTrigger } from './scheduled-trigger-job'

const data = { agentTriggerId: 'trig1', agentId: 'agent1', organizationId: 'org1' }

function ctx(repeatJobKey?: string) {
  return {
    throwIfCancelled: () => {},
    data,
    job: { data, opts: repeatJobKey ? { repeatJobKey } : {} },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  getCachedAgentById.mockResolvedValue({
    userId: 'user1',
    modelId: 'openai:gpt-4',
    archivedAt: null,
    triggers: [{ id: 'trig1', enabled: true, kind: 'scheduled' }],
  })
  createSession.mockResolvedValue({ isErr: () => false, value: { id: 'sess1' } })
})

describe('executeAgentScheduledTrigger', () => {
  it('reads the scheduler id off ctx.job.opts and passes it through', async () => {
    const result = await executeAgentScheduledTrigger(ctx('sched-9'))
    expect(result).toEqual({ success: true, sessionId: 'sess1' })
    expect(createSession).toHaveBeenCalledOnce()
    expect(createSession.mock.calls[0][0].triggerContext).toMatchObject({
      kind: 'scheduled',
      schedulerId: 'sched-9',
    })
    expect(enqueueAgentJob).toHaveBeenCalledOnce()
  })

  it('falls back to a null scheduler id when repeatJobKey is absent', async () => {
    await executeAgentScheduledTrigger(ctx())
    expect(createSession.mock.calls[0][0].triggerContext.schedulerId).toBeNull()
  })

  it('skips and returns when the agent is archived', async () => {
    getCachedAgentById.mockResolvedValue({ userId: 'user1', archivedAt: new Date(), triggers: [] })
    const result = await executeAgentScheduledTrigger(ctx('sched-9'))
    expect(result).toMatchObject({ skipped: true })
    expect(createSession).not.toHaveBeenCalled()
  })
})
