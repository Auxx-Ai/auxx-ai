// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/eval-case-mock-tools.test.ts
//
// `get_eval_case` + `update_eval_case_mock`: the read/write pair for mock
// (fixture) repair. Safety properties: session-agent scoping reads as
// not-found, schema validation runs BEFORE any write, assertions are never
// writable, and the write is approval-gated.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createToolContext, runTool } from '../../../../../agent-framework/__test-helpers'
import type { GetToolDeps } from '../../../types'

vi.mock('../procedure-authoring-guard', () => ({
  resolveProcedureAuthoring: vi.fn(async () => ({ ok: true, agentId: 'a1' })),
}))
vi.mock('../../../../../../evals/queries', () => ({
  getEvalCaseById: vi.fn(),
  updateEvalCase: vi.fn(),
}))
vi.mock('../../../../../../evals/editor-support', () => ({
  validateAgentToolMock: vi.fn(async () => ({ ok: true })),
}))

import { validateAgentToolMock } from '../../../../../../evals/editor-support'
import { getEvalCaseById, updateEvalCase } from '../../../../../../evals/queries'
import { createGetEvalCaseTool } from '../get-eval-case'
import { resolveProcedureAuthoring } from '../procedure-authoring-guard'
import { createUpdateEvalCaseMockTool } from '../update-eval-case-mock'

const guardMock = resolveProcedureAuthoring as unknown as Mock
const getCaseMock = getEvalCaseById as unknown as Mock
const updateCaseMock = updateEvalCase as unknown as Mock
const validateMock = validateAgentToolMock as unknown as Mock

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never
const ctx = createToolContext({ organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' })

const readTool = createGetEvalCaseTool(getDeps)
const writeTool = createUpdateEvalCaseMockTool(getDeps)

const config = {
  openingMessage: 'My mug arrived broken.',
  customerContext: null,
  channel: 'chat',
  timeFrozenAt: null,
  maxCustomerTurns: 4,
  subject: { recordIds: [], identityVerified: false },
  startingFields: [],
  unmatchedToolPolicy: 'error',
  connectorMocks: [{ id: 'm1', toolName: 'order_lookup', output: { id: '1001' }, usage: 'repeat' }],
}

const caseRow = {
  id: 'c1',
  agentId: 'a1',
  name: 'Refund case',
  procedureId: 'p1',
  target: { scope: 'procedure' },
  config,
  assertions: [{ id: 'as1', type: 'terminal_outcome', data: { outcome: 'finished' } }],
}

beforeEach(() => {
  for (const m of [guardMock, getCaseMock, updateCaseMock, validateMock]) m.mockReset()
  guardMock.mockResolvedValue({ ok: true, agentId: 'a1' })
  getCaseMock.mockResolvedValue(ok(caseRow))
  updateCaseMock.mockResolvedValue(ok(caseRow))
  validateMock.mockResolvedValue({ ok: true })
})

describe('tool flags', () => {
  it('get_eval_case is read-only; update_eval_case_mock is approval-gated', () => {
    expect(readTool.idempotent).toBe(true)
    expect(readTool.requiresApproval).toBeUndefined()
    expect(writeTool.requiresApproval).toBe(true)
    expect(writeTool.idempotent).toBeUndefined()
  })

  it('the write surface is mocks-only: no assertion parameter exists', () => {
    const props = (writeTool.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(props).sort()).toEqual(['caseId', 'removeMockIds', 'upsertMocks'])
  })
})

describe('get_eval_case', () => {
  it('returns config (with mocks) and read-only assertions', async () => {
    const result = await runTool(readTool, { caseId: 'c1' }, ctx)
    expect(result.success).toBe(true)
    const output = result.output as {
      config: { connectorMocks: unknown[] }
      assertions: unknown[]
    }
    expect(output.config.connectorMocks).toHaveLength(1)
    expect(output.assertions).toEqual([
      { id: 'as1', type: 'terminal_outcome', data: { outcome: 'finished' } },
    ])
  })

  it("reads another agent's case as not-found", async () => {
    getCaseMock.mockResolvedValue(ok({ ...caseRow, agentId: 'other-agent' }))
    const result = await runTool(readTool, { caseId: 'c1' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('update_eval_case_mock', () => {
  it('replaces a mock in place after schema validation', async () => {
    const result = await runTool(
      writeTool,
      {
        caseId: 'c1',
        upsertMocks: [
          { id: 'm1', toolName: 'order_lookup', output: { id: '10427' }, usage: 'repeat' },
        ],
      },
      ctx
    )
    expect(result.success).toBe(true)
    expect(validateMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'u-1',
      agentId: 'a1',
      toolName: 'order_lookup',
      output: { id: '10427' },
    })
    const patch = updateCaseMock.mock.calls[0]?.[0]?.patch
    expect(patch.config.connectorMocks).toEqual([
      { id: 'm1', toolName: 'order_lookup', output: { id: '10427' }, usage: 'repeat' },
    ])
    // Mocks-only: the patch never carries assertions or target.
    expect(Object.keys(patch)).toEqual(['config'])
  })

  it('appends a new mock with a generated id and removes by id', async () => {
    const result = await runTool(
      writeTool,
      {
        caseId: 'c1',
        upsertMocks: [
          {
            toolName: 'shopify_find_shopify_order',
            args: { mode: 'subset', value: { email: 'alex.morgan@example.com' } },
            output: { orderNumber: '10427' },
          },
        ],
        removeMockIds: ['m1'],
      },
      ctx
    )
    expect(result.success).toBe(true)
    const saved = updateCaseMock.mock.calls[0]?.[0]?.patch.config.connectorMocks
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      toolName: 'shopify_find_shopify_order',
      args: { mode: 'subset', value: { email: 'alex.morgan@example.com' } },
      usage: 'repeat',
    })
    expect(typeof saved[0].id).toBe('string')
    expect(saved[0].id).not.toBe('m1')
  })

  it('rejects an invalid mock output without writing', async () => {
    validateMock.mockResolvedValue({ ok: false, error: 'Expected string for `status`' })
    const result = await runTool(
      writeTool,
      { caseId: 'c1', upsertMocks: [{ toolName: 'order_lookup', output: {} }] },
      ctx
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Expected string')
    expect(updateCaseMock).not.toHaveBeenCalled()
  })

  it('rejects unknown mock ids (replace and remove) without writing', async () => {
    const replace = await runTool(
      writeTool,
      {
        caseId: 'c1',
        upsertMocks: [{ id: 'nope', toolName: 'order_lookup', output: {} }],
      },
      ctx
    )
    expect(replace.success).toBe(false)
    expect(replace.error).toContain('No mock with id "nope"')

    const remove = await runTool(writeTool, { caseId: 'c1', removeMockIds: ['nope'] }, ctx)
    expect(remove.success).toBe(false)
    expect(remove.error).toContain('No mock with id "nope"')
    expect(updateCaseMock).not.toHaveBeenCalled()
  })

  it('requires at least one operation', async () => {
    const result = await runTool(writeTool, { caseId: 'c1' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('at least one')
  })

  it("writes to another agent's case read as not-found", async () => {
    getCaseMock.mockResolvedValue(ok({ ...caseRow, agentId: 'other-agent' }))
    const result = await runTool(writeTool, { caseId: 'c1', removeMockIds: ['m1'] }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(updateCaseMock).not.toHaveBeenCalled()
  })

  it('surfaces guard failures without touching the DB', async () => {
    guardMock.mockResolvedValueOnce({ ok: false, error: 'Not allowed' })
    const result = await runTool(writeTool, { caseId: 'c1', removeMockIds: ['m1'] }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not allowed')
    expect(getCaseMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed save', async () => {
    updateCaseMock.mockResolvedValue(err({ code: 'EVAL_VALIDATION', message: 'Invalid config' }))
    const result = await runTool(writeTool, { caseId: 'c1', removeMockIds: ['m1'] }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid config')
  })
})
