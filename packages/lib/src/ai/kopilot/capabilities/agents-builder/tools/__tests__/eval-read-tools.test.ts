// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/eval-read-tools.test.ts
//
// Phase 5C: the three read-only eval context tools. Org scoping, guard
// enforcement, flag assertions, and the no-eval-mutation safety property.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { AgentDeps } from '../../../../../agent-framework/types'
import type { GetToolDeps } from '../../../types'

vi.mock('../procedure-authoring-guard', () => ({
  resolveProcedureAuthoring: vi.fn(async () => ({ ok: true, agentId: 'a1' })),
}))
vi.mock('../../../../../../evals/queries', () => ({
  listEvalCasesByAgent: vi.fn(),
  getLatestRunsByCaseIds: vi.fn(),
  getEvalRun: vi.fn(),
}))
vi.mock('../../../../../../evals/diff', () => ({
  compareSuiteRuns: vi.fn(),
}))

import { compareSuiteRuns } from '../../../../../../evals/diff'
import {
  getEvalRun,
  getLatestRunsByCaseIds,
  listEvalCasesByAgent,
} from '../../../../../../evals/queries'
import { createGetEvalRunTool } from '../get-eval-run'
import { createGetSuiteDiffTool } from '../get-suite-diff'
import { createListEvalCasesTool } from '../list-eval-cases'
import { resolveProcedureAuthoring } from '../procedure-authoring-guard'

const guardMock = resolveProcedureAuthoring as unknown as Mock
const listCasesMock = listEvalCasesByAgent as unknown as Mock
const latestMock = getLatestRunsByCaseIds as unknown as Mock
const getRunMock = getEvalRun as unknown as Mock
const compareMock = compareSuiteRuns as unknown as Mock

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never
const agentDeps: AgentDeps = { organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' }

const listTool = createListEvalCasesTool(getDeps)
const runTool = createGetEvalRunTool(getDeps)
const diffTool = createGetSuiteDiffTool(getDeps)

beforeEach(() => {
  for (const m of [guardMock, listCasesMock, latestMock, getRunMock, compareMock]) m.mockReset()
  guardMock.mockResolvedValue({ ok: true, agentId: 'a1' })
})

describe('eval read tools — shared safety properties', () => {
  it.each([
    ['list_eval_cases', listTool],
    ['get_eval_run', runTool],
    ['get_suite_diff', diffTool],
  ])('%s is read-only: idempotent, no approval gate', (_name, tool) => {
    expect(tool.idempotent).toBe(true)
    expect(tool.requiresApproval).toBeUndefined()
    expect(tool.outputSchema).toBeDefined()
    expect(tool.exampleOutput).toBeDefined()
  })

  it.each([
    ['list_eval_cases', listTool, {}],
    ['get_eval_run', runTool, { runId: 'r1' }],
    ['get_suite_diff', diffTool, { baselineSuiteRunId: 'b', candidateSuiteRunId: 'c' }],
  ])('%s surfaces a guard failure without touching the DB', async (_name, tool, args) => {
    guardMock.mockResolvedValueOnce({ ok: false, error: 'Not allowed' })
    const result = await tool.execute(args as never, agentDeps)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not allowed')
    expect(listCasesMock).not.toHaveBeenCalled()
    expect(getRunMock).not.toHaveBeenCalled()
    expect(compareMock).not.toHaveBeenCalled()
  })
})

describe('list_eval_cases', () => {
  it('lists the session agent org-scoped with assertion counts and last-verified status', async () => {
    listCasesMock.mockResolvedValue(
      ok([
        {
          id: 'c1',
          name: 'Refund case',
          target: { scope: 'procedure' },
          procedureId: 'p1',
          assertions: [
            { type: 'terminal_outcome' },
            { type: 'response_criteria' },
            { type: 'response_criteria' },
          ],
        },
      ])
    )
    latestMock.mockResolvedValue(
      ok([
        {
          caseId: 'c1',
          runId: 'r-draft',
          status: 'failed',
          runMode: 'draft',
          createdAt: new Date(),
          completedAt: null,
          latestPinned: {
            caseId: 'c1',
            runId: 'r-pinned',
            status: 'passed',
            runMode: 'pinned',
            createdAt: new Date(),
            completedAt: null,
          },
        },
      ])
    )

    const result = await listTool.execute({ procedureId: 'p1' } as never, agentDeps)
    expect(result.success).toBe(true)
    expect(listCasesMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      agentId: 'a1',
      procedureId: 'p1',
    })
    const output = result.output as { cases: Record<string, unknown>[]; total: number }
    expect(output.total).toBe(1)
    expect(output.cases[0]).toMatchObject({
      id: 'c1',
      scope: 'procedure',
      assertionCounts: { terminal_outcome: 1, response_criteria: 2 },
      latestRun: { runId: 'r-draft', status: 'failed', runMode: 'draft' },
      latestPinnedRun: { runId: 'r-pinned', status: 'passed' },
    })
  })
})

describe('get_eval_run', () => {
  it('reads org-scoped and condenses via the model summary', async () => {
    getRunMock.mockResolvedValue(
      ok({
        id: 'r1',
        status: 'failed',
        runMode: 'pinned',
        caseId: 'c1',
        definitionSnapshot: { case: { name: 'Refund case' } },
        trace: [],
        assertionResults: [],
        errorCode: null,
        error: null,
      })
    )
    const result = await runTool.execute({ runId: 'r1' } as never, agentDeps)
    expect(result.success).toBe(true)
    expect(getRunMock).toHaveBeenCalledWith({ organizationId: 'org-1', runId: 'r1' })
    expect((result.output as { caseName: string }).caseName).toBe('Refund case')
    expect((result.output as { caseId: string | null }).caseId).toBe('c1')
  })

  it('returns not-found for a cross-org run id without leaking', async () => {
    getRunMock.mockResolvedValue(ok(null))
    const result = await runTool.execute({ runId: 'foreign' } as never, agentDeps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('get_suite_diff', () => {
  it('condenses the diff summary for the model', async () => {
    compareMock.mockResolvedValue(
      ok({
        baselineSuiteRunId: 'b',
        candidateSuiteRunId: 'c',
        baselineRunMode: 'pinned',
        candidateRunMode: 'draft',
        counts: {
          fixed: 1,
          regressed: 0,
          still_failing: 0,
          still_passing: 0,
          incomparable: 0,
          uncompared: 0,
        },
        passRateDelta: 1,
        judgeOnlyFlips: 0,
        entries: [
          {
            caseId: 'c1',
            caseName: 'Refund case',
            bucket: 'fixed',
            flipDriver: 'deterministic',
            assertionFlips: [
              { assertionId: 'a1', type: 'tool_called', from: 'failed', to: 'passed' },
            ],
          },
        ],
      })
    )

    const result = await diffTool.execute(
      { baselineSuiteRunId: 'b', candidateSuiteRunId: 'c' } as never,
      agentDeps
    )
    expect(result.success).toBe(true)
    expect(compareMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      baselineSuiteRunId: 'b',
      candidateSuiteRunId: 'c',
    })
    const output = result.output as { entries: Record<string, unknown>[] }
    expect(output.entries[0]).toEqual({
      caseName: 'Refund case',
      bucket: 'fixed',
      flipDriver: 'deterministic',
      assertionFlips: ['tool_called: failed→passed'],
    })
  })

  it('surfaces non-terminal/not-found errors as the tool result', async () => {
    compareMock.mockResolvedValue(
      err({ code: 'SUITE_NOT_TERMINAL', message: 'Suite run is not terminal: c (running)' })
    )
    const result = await diffTool.execute(
      { baselineSuiteRunId: 'b', candidateSuiteRunId: 'c' } as never,
      agentDeps
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('not terminal')
  })
})
