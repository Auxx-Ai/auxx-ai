// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/run-eval-suite.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createToolContext, runTool } from '../../../../../agent-framework/__test-helpers'
import type { GetToolDeps } from '../../../types'

// Force the auth guard to pass so we can exercise the tool's own logic.
vi.mock('../procedure-authoring-guard', () => ({
  resolveProcedureAuthoring: vi.fn(async () => ({ ok: true, agentId: 'a1' })),
}))
// Stub the suite-start recipe (DB + enqueue).
vi.mock('../../../../../../evals/start-suite-run', () => ({
  startAgentSuiteRun: vi.fn(),
}))

import { startAgentSuiteRun } from '../../../../../../evals/start-suite-run'
import { resolveProcedureAuthoring } from '../procedure-authoring-guard'
import { createRunEvalSuiteTool } from '../run-eval-suite'

const startMock = startAgentSuiteRun as unknown as Mock
const guardMock = resolveProcedureAuthoring as unknown as Mock

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never
const ctx = createToolContext({ organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' })
const tool = createRunEvalSuiteTool(getDeps)

beforeEach(() => {
  guardMock.mockClear()
  guardMock.mockResolvedValue({ ok: true, agentId: 'a1' })
  startMock.mockReset()
  startMock.mockResolvedValue(
    ok({ suiteRun: { id: 'esr_1' }, runIds: ['er_1', 'er_2'], requestedCount: 2 })
  )
})

describe('run_eval_suite', () => {
  it('requires human approval (the spend gate / burn-loop cap)', () => {
    expect(tool.requiresApproval).toBe(true)
  })

  it('starts the suite for the session agent and returns a taskNotification ref', async () => {
    const result = await runTool(tool, { useDraft: true }, ctx)
    expect(result.success).toBe(true)
    expect(startMock).toHaveBeenCalledOnce()
    expect(startMock.mock.calls[0]![0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'u-1',
      agentId: 'a1',
      useDraft: true,
    })
    const output = result.output as {
      suiteRunId: string
      requestedCount: number
      status: string
      taskNotification: { kind: string; ref: string }
      note: string
    }
    expect(output.suiteRunId).toBe('esr_1')
    expect(output.requestedCount).toBe(2)
    expect(output.status).toBe('running')
    expect(output.taskNotification).toEqual({ kind: 'eval-suite', ref: 'esr_1' })
    expect(output.note).toContain('end your turn')
  })

  it('passes procedureId and filters caseIds to strings', async () => {
    await runTool(tool, { procedureId: 'p1', caseIds: ['c1', 42, '', 'c2'] }, ctx)
    expect(startMock.mock.calls[0]![0]).toMatchObject({
      procedureId: 'p1',
      caseIds: ['c1', 'c2'],
    })
  })

  it('surfaces the guard failure without starting anything', async () => {
    guardMock.mockResolvedValueOnce({ ok: false, error: 'Not allowed' })
    const result = await runTool(tool, {}, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not allowed')
    expect(startMock).not.toHaveBeenCalled()
  })

  it('surfaces a start failure (e.g. no cases selected)', async () => {
    startMock.mockResolvedValueOnce(
      err({ code: 'EVAL_VALIDATION', message: 'No eval cases selected' })
    )
    const result = await runTool(tool, {}, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No eval cases selected')
  })

  it('digest projects the suite ref + count', () => {
    expect(tool.buildDigest?.({ suiteRunId: 'esr_1', requestedCount: 2, note: 'x' })).toEqual({
      suiteRunId: 'esr_1',
      requestedCount: 2,
    })
  })
})
