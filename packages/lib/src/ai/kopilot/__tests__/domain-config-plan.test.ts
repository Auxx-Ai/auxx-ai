// packages/lib/src/ai/kopilot/__tests__/domain-config-plan.test.ts

import { describe, expect, it } from 'vitest'
import type { AgentState, AgentToolResult } from '../../agent-framework/types'
import { createKopilotDomainConfig } from '../domain-config'
import type { KopilotDomainState, PlanState } from '../types'

function makeState(domain: Partial<KopilotDomainState> = {}): AgentState {
  return {
    messages: [],
    domainState: { context: {}, ...domain } as KopilotDomainState,
  }
}

const ok = (output: unknown): AgentToolResult => ({ success: true, output })

describe('kopilot domainConfig.onToolResult — plan tools', () => {
  const cfg = createKopilotDomainConfig()

  it('plan_create populates domainState.plan', () => {
    const plan: PlanState = {
      steps: [
        { id: 's1', label: 'Step one', status: 'pending' },
        { id: 's2', label: 'Step two', status: 'pending' },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const next = cfg.onToolResult!('plan_create', ok({ plan }), makeState())
    const ds = next.domainState as KopilotDomainState
    expect(ds.plan).toEqual(plan)
  })

  it('plan_update_step updates the step status by id and bumps updatedAt', () => {
    const initial: PlanState = {
      steps: [
        { id: 's1', label: 'A', status: 'pending' },
        { id: 's2', label: 'B', status: 'pending' },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const before = Date.now()
    const next = cfg.onToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 's1', status: 'running' } }),
      makeState({ plan: initial })
    )
    const after = Date.now()

    const ds = next.domainState as KopilotDomainState
    const plan = ds.plan
    expect(plan).toBeDefined()
    expect(plan?.steps[0]).toEqual({ id: 's1', label: 'A', status: 'running' })
    expect(plan?.steps[1]).toEqual({ id: 's2', label: 'B', status: 'pending' }) // untouched
    expect(plan?.createdAt).toBe(1000)
    expect(plan?.updatedAt).toBeGreaterThanOrEqual(before)
    expect(plan?.updatedAt).toBeLessThanOrEqual(after)
  })

  it('plan_update_step merges optional detail into the matched step', () => {
    const initial: PlanState = {
      steps: [{ id: 's1', label: 'A', status: 'running' }],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const next = cfg.onToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 's1', status: 'completed', detail: 'done' } }),
      makeState({ plan: initial })
    )
    const ds = next.domainState as KopilotDomainState
    expect(ds.plan?.steps[0]).toMatchObject({
      id: 's1',
      status: 'completed',
      detail: 'done',
    })
  })

  it('plan_update_step against unknown stepId leaves the plan unchanged', () => {
    const initial: PlanState = {
      steps: [{ id: 's1', label: 'A', status: 'pending' }],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const next = cfg.onToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 'bogus', status: 'running' } }),
      makeState({ plan: initial })
    )
    const ds = next.domainState as KopilotDomainState
    // Plan untouched. Equality check covers steps + createdAt + updatedAt.
    expect(ds.plan).toEqual(initial)
  })
})

describe('kopilot domainConfig.transformToolResult — plan tools', () => {
  const cfg = createKopilotDomainConfig()

  it('plan_create returns undefined (raw output already canonical)', () => {
    const out = cfg.transformToolResult!('plan_create', ok({ plan: null }), makeState())
    expect(out).toBeUndefined()
  })

  it('plan_update_step after a successful patch returns the canonical plan', () => {
    const plan: PlanState = {
      steps: [{ id: 's1', label: 'A', status: 'running' }],
      createdAt: 1000,
      updatedAt: 2000,
    }
    const out = cfg.transformToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 's1', status: 'running' } }),
      makeState({ plan })
    )
    expect(out).toEqual({ success: true, output: { plan } })
  })

  it('plan_update_step with no active plan returns a recoverable error', () => {
    const out = cfg.transformToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 's1', status: 'running' } }),
      makeState() // no plan
    )
    expect(out).toEqual({
      success: false,
      output: { plan: null },
      error: expect.stringMatching(/no active plan/i),
    })
  })

  it('plan_update_step with unknown stepId returns the current plan + error', () => {
    const plan: PlanState = {
      steps: [{ id: 's1', label: 'A', status: 'pending' }],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const out = cfg.transformToolResult!(
      'plan_update_step',
      ok({ _planPatch: { stepId: 'bogus', status: 'running' } }),
      makeState({ plan })
    )
    expect(out?.success).toBe(false)
    expect(out?.error).toMatch(/no plan step with id "bogus"/i)
    expect((out?.output as { plan: PlanState }).plan).toEqual(plan)
  })

  it('returns undefined for unrelated tools', () => {
    const out = cfg.transformToolResult!('something_else', ok({ anything: true }), makeState())
    expect(out).toBeUndefined()
  })
})
