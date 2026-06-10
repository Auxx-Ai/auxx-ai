// packages/lib/src/evals/__tests__/prepare-run.test.ts

import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import { err, ok } from 'neverthrow'

vi.mock('../../agents/procedures', () => ({
  compileProcedure: vi.fn(),
  getProcedureVersionById: vi.fn(),
  readCompiled: vi.fn(),
}))
vi.mock('../../agents/procedures/authoring/queries', () => ({
  getAttachedProcedureDraft: vi.fn(),
}))
vi.mock('../../ai/agent-framework/effective-runtime', () => ({
  buildEffectiveAgentRuntime: vi.fn(),
}))
vi.mock('../../cache', () => ({
  getCachedAgentById: vi.fn(),
}))

import { compileProcedure, getProcedureVersionById, readCompiled } from '../../agents/procedures'
import { getAttachedProcedureDraft } from '../../agents/procedures/authoring/queries'
import { buildEffectiveAgentRuntime } from '../../ai/agent-framework/effective-runtime'
import { getCachedAgentById } from '../../cache'
import { prepareRunSnapshots } from '../prepare-run'

const mockedCompile = compileProcedure as unknown as ReturnType<typeof vi.fn>
const mockedGetVersion = getProcedureVersionById as unknown as ReturnType<typeof vi.fn>
const mockedReadCompiled = readCompiled as unknown as ReturnType<typeof vi.fn>
const mockedDraft = getAttachedProcedureDraft as unknown as ReturnType<typeof vi.fn>
const mockedRuntime = buildEffectiveAgentRuntime as unknown as ReturnType<typeof vi.fn>
const mockedAgent = getCachedAgentById as unknown as ReturnType<typeof vi.fn>

// biome-ignore lint/suspicious/noExplicitAny: minimal CompiledProcedure stand-ins
const PINNED_COMPILED = { steps: {}, entryStepId: null, tag: 'pinned' } as any
// biome-ignore lint/suspicious/noExplicitAny: minimal CompiledProcedure stand-ins
const DRAFT_COMPILED = { steps: {}, entryStepId: null, tag: 'draft' } as any

const TARGET: AgentEvalTarget = {
  kind: 'agent_simulation',
  scope: 'procedure',
  agentId: 'a',
  procedureId: 'p',
  procedureVersionId: 'v1',
}

const CONFIG: SimulationConfig = {
  openingMessage: 'hi',
  customerContext: null,
  channel: 'chat',
  timeFrozenAt: null,
  maxCustomerTurns: 3,
  subject: { recordIds: [], identityVerified: false },
  startingFields: [],
  unmatchedToolPolicy: 'error',
  connectorMocks: [],
}

const ASSERTIONS: AgentEvalAssertion[] = [
  { id: 'x', type: 'terminal_outcome', data: { outcome: 'finished' } },
]

const CASE = {
  id: 'c1',
  name: 'Case',
  createdAt: '2026-01-01T00:00:00.000Z',
  target: TARGET,
  config: CONFIG,
  assertions: ASSERTIONS,
}

function prepare(mode?: 'pinned' | 'draft') {
  return prepareRunSnapshots({ organizationId: 'org', userId: 'u', case: CASE, mode })
}

beforeEach(() => {
  for (const m of [
    mockedCompile,
    mockedGetVersion,
    mockedReadCompiled,
    mockedDraft,
    mockedRuntime,
    mockedAgent,
  ]) {
    m.mockReset()
  }
  mockedRuntime.mockResolvedValue({
    tools: [],
    model: { provider: 'p', model: 'm' },
    utilityModel: { provider: 'p', model: 'mu' },
    agentConfig: { appAccounts: {}, toolRestrictions: null },
  })
  mockedAgent.mockResolvedValue({ kind: 'internal', procedures: [] })
  mockedGetVersion.mockResolvedValue(ok({ id: 'v1' }))
  mockedReadCompiled.mockReturnValue(PINNED_COMPILED)
})

describe('prepareRunSnapshots — run mode', () => {
  it('pins the published version by default (byte-identical to pinned mode)', async () => {
    const result = await prepare()
    expect(result.isOk()).toBe(true)
    const snap = result._unsafeUnwrap().runtimeSnapshot
    expect(snap.runMode).toBe('pinned')
    expect(snap.draftContentHash).toBeUndefined()
    expect(snap.procedures).toEqual([{ id: 'p', versionId: 'v1', compiled: PINNED_COMPILED }])
    expect(mockedDraft).not.toHaveBeenCalled()
  })

  it('compiles and pins the draft in draft mode, stamping runMode + content hash', async () => {
    mockedDraft.mockResolvedValue(ok({ draftDoc: { type: 'doc', content: [] } }))
    mockedCompile.mockReturnValue({ compiled: DRAFT_COMPILED, contentHash: 'dhash', errors: [] })

    const result = await prepare('draft')
    expect(result.isOk()).toBe(true)
    const snap = result._unsafeUnwrap().runtimeSnapshot
    expect(snap.runMode).toBe('draft')
    expect(snap.draftContentHash).toBe('dhash')
    // The pinned versionId remains the record-keeping anchor; the compiled graph is the draft's.
    expect(snap.procedures).toEqual([{ id: 'p', versionId: 'v1', compiled: DRAFT_COMPILED }])
  })

  it('fails with DRAFT_COMPILE_FAILED carrying the structured CompileError[] when the draft does not compile', async () => {
    mockedDraft.mockResolvedValue(ok({ draftDoc: { type: 'doc', content: [] } }))
    mockedCompile.mockReturnValue({
      compiled: DRAFT_COMPILED,
      contentHash: 'dhash',
      errors: [{ code: 'CYCLE', message: 'cycle detected', stepId: 's1' }],
    })

    const result = await prepare('draft')
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.code).toBe('DRAFT_COMPILE_FAILED')
    if (error.code !== 'DRAFT_COMPILE_FAILED') throw new Error('unreachable')
    expect(error.message).toContain('cycle detected')
    expect(error.errors).toEqual([{ code: 'CYCLE', message: 'cycle detected', stepId: 's1' }])
  })

  it('falls back to the pinned version when no draft is available', async () => {
    mockedDraft.mockResolvedValue(err({ code: 'DB', message: 'PROCEDURE_OR_DRAFT_NOT_FOUND' }))

    const result = await prepare('draft')
    expect(result.isOk()).toBe(true)
    const snap = result._unsafeUnwrap().runtimeSnapshot
    expect(snap.runMode).toBe('pinned')
    expect(snap.procedures[0]?.compiled).toBe(PINNED_COMPILED)
  })
})
