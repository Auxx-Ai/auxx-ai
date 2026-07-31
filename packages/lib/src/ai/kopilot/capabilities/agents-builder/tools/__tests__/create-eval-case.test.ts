// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/create-eval-case.test.ts
//
// `create_eval_case`: the approval-gated case authoring surface. Safety + wiring
// properties: it's approval-gated, target resolution pins active-or-draft version
// (so cases work mid-build), an unattached procedure / missing version / builder
// failure aborts before any write, and the validated case is persisted with the
// session user's provenance.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createToolContext, runTool } from '../../../../../agent-framework/__test-helpers'
import type { GetToolDeps } from '../../../types'

vi.mock('../procedure-authoring-guard', () => ({
  resolveProcedureAuthoring: vi.fn(async () => ({ ok: true, agentId: 'a1' })),
}))
vi.mock('../../../../../../agents/procedures/authoring', () => ({
  listAgentProceduresForAuthoring: vi.fn(),
}))
vi.mock('../../../../../../evals/authoring', () => ({
  resolveAgentMockToolContext: vi.fn(),
  buildSimulationCaseFromAuthoring: vi.fn(),
}))
vi.mock('../../../../../../evals/queries', () => ({
  createEvalCase: vi.fn(),
}))

import { listAgentProceduresForAuthoring } from '../../../../../../agents/procedures/authoring'
import {
  buildSimulationCaseFromAuthoring,
  resolveAgentMockToolContext,
} from '../../../../../../evals/authoring'
import { createEvalCase } from '../../../../../../evals/queries'
import { createCreateEvalCaseTool } from '../create-eval-case'
import { resolveProcedureAuthoring } from '../procedure-authoring-guard'

const guardMock = resolveProcedureAuthoring as unknown as Mock
const listProcsMock = listAgentProceduresForAuthoring as unknown as Mock
const resolveCtxMock = resolveAgentMockToolContext as unknown as Mock
const buildMock = buildSimulationCaseFromAuthoring as unknown as Mock
const createMock = createEvalCase as unknown as Mock

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never
const ctx = createToolContext({ organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' })

const tool = createCreateEvalCaseTool(getDeps)

const builtCase = {
  name: 'Missing order number',
  config: {
    openingMessage: "Where's my order?",
    customerContext: 'No order number on hand.',
    channel: 'chat',
    timeFrozenAt: null,
    maxCustomerTurns: 4,
    subject: { recordIds: [], identityVerified: false },
    startingFields: [],
    unmatchedToolPolicy: 'error',
    connectorMocks: [{ id: 'm1', toolName: 'order_lookup', output: { id: '1' }, usage: 'repeat' }],
  },
  assertions: [
    { id: 'as1', type: 'terminal_outcome', data: { outcome: 'finished' } },
    { id: 'as2', type: 'response_criteria', data: { criteria: ['asks for order number'] } },
  ],
}

const validArgs = {
  name: 'Missing order number',
  openingMessage: "Where's my order?",
  customerContext: 'No order number on hand.',
  channel: 'chat',
  assertions: [{ type: 'terminal_outcome', outcome: 'finished' }],
}

beforeEach(() => {
  for (const m of [guardMock, listProcsMock, resolveCtxMock, buildMock, createMock]) m.mockReset()
  guardMock.mockResolvedValue({ ok: true, agentId: 'a1' })
  listProcsMock.mockResolvedValue(
    ok([{ procedureId: 'p1', activeVersionId: 'v-active', draftVersionId: 'v-draft' }])
  )
  resolveCtxMock.mockResolvedValue({ toolMap: new Map(), toolEntries: [], utilityModel: {} })
  buildMock.mockReturnValue(ok(builtCase))
  createMock.mockResolvedValue(ok({ id: 'case-new', agentId: 'a1' }))
})

describe('tool flags', () => {
  it('is the builder-surface, approval-gated create surface', () => {
    expect(tool.name).toBe('create_eval_case')
    expect(tool.requiresApproval).toBe(true)
    expect(tool.surfaces).toEqual(['builder'])
  })
})

describe('agent-scoped create', () => {
  it('persists an agent-scoped case when no procedureId is given', async () => {
    const result = await runTool(tool, validArgs, ctx)
    expect(result.success).toBe(true)
    expect(listProcsMock).not.toHaveBeenCalled()
    const arg = createMock.mock.calls[0]?.[0]
    expect(arg.target).toEqual({ kind: 'agent_simulation', scope: 'agent', agentId: 'a1' })
    expect(arg.createdById).toBe('u-1')
    expect(arg.name).toBe('Missing order number')
    expect(arg.config).toBe(builtCase.config)
    expect(arg.assertions).toBe(builtCase.assertions)
    expect(result.output).toMatchObject({
      caseId: 'case-new',
      scope: 'agent',
      procedureId: null,
      assertionCount: 2,
      mockCount: 1,
    })
  })

  it('forwards the authored shape to the shared builder', async () => {
    await runTool(tool, validArgs, ctx)
    const authored = buildMock.mock.calls[0]?.[0]
    expect(authored).toMatchObject({
      name: 'Missing order number',
      openingMessage: "Where's my order?",
      channel: 'chat',
    })
  })
})

describe('procedure-scoped create — version pinning', () => {
  it('pins the active version when published', async () => {
    const result = await runTool(tool, { ...validArgs, procedureId: 'p1' }, ctx)
    expect(result.success).toBe(true)
    expect(createMock.mock.calls[0]?.[0].target).toEqual({
      kind: 'agent_simulation',
      scope: 'procedure',
      agentId: 'a1',
      procedureId: 'p1',
      procedureVersionId: 'v-active',
    })
    expect(result.output).toMatchObject({ scope: 'procedure', procedureId: 'p1' })
  })

  it('falls back to the draft version when never published', async () => {
    listProcsMock.mockResolvedValue(
      ok([{ procedureId: 'p1', activeVersionId: null, draftVersionId: 'v-draft' }])
    )
    const result = await runTool(tool, { ...validArgs, procedureId: 'p1' }, ctx)
    expect(result.success).toBe(true)
    expect(createMock.mock.calls[0]?.[0].target.procedureVersionId).toBe('v-draft')
  })

  it('errors (no write) when the procedure has no version at all', async () => {
    listProcsMock.mockResolvedValue(
      ok([{ procedureId: 'p1', activeVersionId: null, draftVersionId: null }])
    )
    const result = await runTool(tool, { ...validArgs, procedureId: 'p1' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('no version')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('errors (no write) when the procedure is not attached to the agent', async () => {
    listProcsMock.mockResolvedValue(ok([{ procedureId: 'other', activeVersionId: 'v' }]))
    const result = await runTool(tool, { ...validArgs, procedureId: 'p1' }, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not attached')
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('validation + guard', () => {
  it('surfaces a builder validation failure without writing', async () => {
    buildMock.mockReturnValue(err('unknown mock tool "frobnicate"'))
    const result = await runTool(tool, validArgs, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('frobnicate')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('surfaces guard failures without touching the runtime or DB', async () => {
    guardMock.mockResolvedValueOnce({ ok: false, error: 'Not allowed' })
    const result = await runTool(tool, validArgs, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not allowed')
    expect(resolveCtxMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('surfaces a failed persist', async () => {
    createMock.mockResolvedValue(err({ code: 'EVAL_VALIDATION', message: 'Bad config' }))
    const result = await runTool(tool, validArgs, ctx)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Bad config')
  })
})
