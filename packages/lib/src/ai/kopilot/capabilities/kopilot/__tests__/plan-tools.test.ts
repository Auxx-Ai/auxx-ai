// packages/lib/src/ai/kopilot/capabilities/kopilot/__tests__/plan-tools.test.ts

import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../../../agent-framework/tool-context'
import type { GetToolDeps } from '../../types'
import { createPlanCreateTool } from '../tools/plan-create'
import { createPlanUpdateStepTool } from '../tools/plan-update-step'

const FAKE_DEPS: GetToolDeps = () =>
  ({
    db: {} as never,
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
  }) as ReturnType<GetToolDeps>

const FAKE_CTX = {} as ToolContext

describe('plan_create.execute', () => {
  const tool = createPlanCreateTool(FAKE_DEPS)

  it('returns canonical plan with generated step ids and pending status', async () => {
    const result = await tool.execute(
      { steps: [{ label: 'List tickets' }, { label: 'Reply to each', detail: 'send each one' }] },
      FAKE_CTX
    )

    expect(result.success).toBe(true)
    const plan = (
      result.output as { plan: { steps: unknown[]; createdAt: number; updatedAt: number } }
    ).plan
    expect(plan.steps).toHaveLength(2)
    expect(plan.createdAt).toBeTypeOf('number')
    expect(plan.updatedAt).toBe(plan.createdAt)

    const [s1, s2] = plan.steps as Array<{
      id: string
      label: string
      status: string
      detail?: string
    }>
    expect(s1.id).toMatch(/^plan-step-/)
    expect(s2.id).toMatch(/^plan-step-/)
    expect(s1.id).not.toBe(s2.id)
    expect(s1.label).toBe('List tickets')
    expect(s1.status).toBe('pending')
    expect(s1.detail).toBeUndefined()
    expect(s2.detail).toBe('send each one')
  })

  it('rejects an empty step list', async () => {
    const result = await tool.execute({ steps: [] }, FAKE_CTX)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/at least one step/i)
  })

  it('rejects more than 30 steps', async () => {
    const steps = Array.from({ length: 31 }, (_, i) => ({ label: `Step ${i + 1}` }))
    const result = await tool.execute({ steps }, FAKE_CTX)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/exceeds max 30 steps/i)
  })

  it('truncates labels longer than 200 chars', async () => {
    const longLabel = 'a'.repeat(250)
    const result = await tool.execute({ steps: [{ label: longLabel }] }, FAKE_CTX)
    expect(result.success).toBe(true)
    const plan = (result.output as { plan: { steps: Array<{ label: string }> } }).plan
    expect(plan.steps[0]?.label).toHaveLength(200)
  })
})

describe('plan_update_step.execute', () => {
  const tool = createPlanUpdateStepTool(FAKE_DEPS)

  it('returns _planPatch sentinel on success', async () => {
    const result = await tool.execute({ stepId: 'plan-step_abc', status: 'running' }, FAKE_CTX)
    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      _planPatch: { stepId: 'plan-step_abc', status: 'running' },
    })
  })

  it('includes detail in the patch when provided', async () => {
    const result = await tool.execute(
      { stepId: 'plan-step_abc', status: 'completed', detail: '5 contacts loaded' },
      FAKE_CTX
    )
    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      _planPatch: {
        stepId: 'plan-step_abc',
        status: 'completed',
        detail: '5 contacts loaded',
      },
    })
  })

  it('rejects invalid status values', async () => {
    const result = await tool.execute({ stepId: 'plan-step_abc', status: 'bogus' }, FAKE_CTX)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid status/i)
  })
})
