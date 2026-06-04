// packages/lib/src/ai/kopilot/capabilities/kopilot/__tests__/plan-tools.test.ts

import { describe, expect, it } from 'vitest'
import { KopilotContextStore } from '../../../../agent-framework/context'
import type { ToolContext } from '../../../../agent-framework/tool-context'
import type { PlanState } from '../../../types'
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

/** A ToolContext carrying a real (empty) context store — plan state lives in var:plan. */
function makeCtx(): ToolContext {
  const baseCtx = {
    organizationId: 'org-1',
    userId: 'user-1',
    sessionId: 'sess-1',
    db: {} as never,
  } as unknown as ToolContext
  return { ...baseCtx, context: new KopilotContextStore({ ctx: baseCtx }) } as ToolContext
}

describe('plan_create.execute', () => {
  const tool = createPlanCreateTool(FAKE_DEPS)

  it('returns canonical plan with generated step ids and pending status, and persists var:plan', async () => {
    const ctx = makeCtx()
    const result = await tool.execute(
      { steps: [{ label: 'List tickets' }, { label: 'Reply to each', detail: 'send each one' }] },
      ctx
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

    // The plan is now readable from var:plan.
    expect(await ctx.context.read('var:plan')).toEqual(plan)
  })

  it('rejects an empty step list', async () => {
    const result = await tool.execute({ steps: [] }, makeCtx())
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/at least one step/i)
  })

  it('rejects more than 30 steps', async () => {
    const steps = Array.from({ length: 31 }, (_, i) => ({ label: `Step ${i + 1}` }))
    const result = await tool.execute({ steps }, makeCtx())
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/exceeds max 30 steps/i)
  })

  it('truncates labels longer than 200 chars', async () => {
    const longLabel = 'a'.repeat(250)
    const result = await tool.execute({ steps: [{ label: longLabel }] }, makeCtx())
    expect(result.success).toBe(true)
    const plan = (result.output as { plan: { steps: Array<{ label: string }> } }).plan
    expect(plan.steps[0]?.label).toHaveLength(200)
  })
})

describe('plan_update_step.execute', () => {
  const tool = createPlanUpdateStepTool(FAKE_DEPS)

  /** Seed a ctx whose var:plan holds the given plan. */
  async function ctxWithPlan(plan: PlanState): Promise<ToolContext> {
    const ctx = makeCtx()
    await ctx.context.write('var:plan', plan)
    return ctx
  }

  const basePlan = (): PlanState => ({
    steps: [
      { id: 's1', label: 'A', status: 'pending' },
      { id: 's2', label: 'B', status: 'pending' },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  })

  it('patches the step status by id, bumps updatedAt, and writes back', async () => {
    const ctx = await ctxWithPlan(basePlan())
    const before = Date.now()
    const result = await tool.execute({ stepId: 's1', status: 'running' }, ctx)
    const after = Date.now()

    expect(result.success).toBe(true)
    const plan = (result.output as { plan: PlanState }).plan
    expect(plan.steps[0]).toEqual({ id: 's1', label: 'A', status: 'running' })
    expect(plan.steps[1]).toEqual({ id: 's2', label: 'B', status: 'pending' }) // untouched
    expect(plan.createdAt).toBe(1000)
    expect(plan.updatedAt).toBeGreaterThanOrEqual(before)
    expect(plan.updatedAt).toBeLessThanOrEqual(after)
    // Persisted back to var:plan.
    expect(((await ctx.context.read('var:plan')) as PlanState).steps[0]?.status).toBe('running')
  })

  it('merges optional detail into the matched step', async () => {
    const ctx = await ctxWithPlan({
      steps: [{ id: 's1', label: 'A', status: 'running' }],
      createdAt: 1000,
      updatedAt: 1000,
    })
    const result = await tool.execute({ stepId: 's1', status: 'completed', detail: 'done' }, ctx)
    expect(result.success).toBe(true)
    expect((result.output as { plan: PlanState }).plan.steps[0]).toMatchObject({
      id: 's1',
      status: 'completed',
      detail: 'done',
    })
  })

  it('rejects invalid status values', async () => {
    const result = await tool.execute(
      { stepId: 's1', status: 'bogus' },
      await ctxWithPlan(basePlan())
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid status/i)
  })

  it('errors with a recoverable message when there is no active plan', async () => {
    const result = await tool.execute({ stepId: 's1', status: 'running' }, makeCtx())
    expect(result.success).toBe(false)
    expect(result.output).toEqual({ plan: null })
    expect(result.error).toMatch(/no active plan/i)
  })

  it('errors and attaches the current plan for an unknown stepId', async () => {
    const plan = basePlan()
    const result = await tool.execute(
      { stepId: 'bogus', status: 'running' },
      await ctxWithPlan(plan)
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no plan step with id "bogus"/i)
    expect((result.output as { plan: PlanState }).plan).toEqual(plan)
  })
})
