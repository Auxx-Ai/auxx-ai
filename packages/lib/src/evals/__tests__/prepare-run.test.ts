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
// Authorization resolution is its own unit (`agent-run-capabilities.test.ts`);
// here only the WIRING matters — which `source` an eval run asks for, and that
// the resulting view reaches the runtime builder. Mocked also because the real
// module pulls the org-cache helper chain in at import time.
vi.mock('../../ai/agent-framework/agent-run-capabilities', () => ({
  resolveAgentRunCapabilities: vi.fn(),
}))
vi.mock('../../cache', () => ({
  getCachedAgentById: vi.fn(),
}))

// Draft-mode agent-config hashing reads the Agent row directly; stub the query
// chain (the rows are set per-test via `agentRowRef`). schema columns are only
// used to build the (unexecuted) where clause, so a Proxy of empty objects suffices.
const { agentRowRef } = vi.hoisted(() => ({
  agentRowRef: { rows: [] as Record<string, unknown>[] },
}))
vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(agentRowRef.rows) }) }),
    }),
  },
  schema: { Agent: new Proxy({}, { get: () => ({}) }) },
}))

import { compileProcedure, getProcedureVersionById, readCompiled } from '../../agents/procedures'
import { getAttachedProcedureDraft } from '../../agents/procedures/authoring/queries'
import { resolveAgentRunCapabilities } from '../../ai/agent-framework/agent-run-capabilities'
import { buildEffectiveAgentRuntime } from '../../ai/agent-framework/effective-runtime'
import { getCachedAgentById } from '../../cache'
import { prepareRunSnapshots } from '../prepare-run'

const mockedCompile = compileProcedure as unknown as ReturnType<typeof vi.fn>
const mockedGetVersion = getProcedureVersionById as unknown as ReturnType<typeof vi.fn>
const mockedReadCompiled = readCompiled as unknown as ReturnType<typeof vi.fn>
const mockedDraft = getAttachedProcedureDraft as unknown as ReturnType<typeof vi.fn>
const mockedRuntime = buildEffectiveAgentRuntime as unknown as ReturnType<typeof vi.fn>
const mockedAgent = getCachedAgentById as unknown as ReturnType<typeof vi.fn>
const mockedCaps = resolveAgentRunCapabilities as unknown as ReturnType<typeof vi.fn>

// biome-ignore lint/suspicious/noExplicitAny: minimal CompiledProcedure stand-ins
const PINNED_COMPILED = { steps: {}, entryStepId: null, tag: 'pinned' } as any
// biome-ignore lint/suspicious/noExplicitAny: minimal CompiledProcedure stand-ins
const DRAFT_COMPILED = { steps: {}, entryStepId: null, tag: 'draft' } as any

/** Identity stand-in for the resolved `CapabilityView` — only referential equality matters. */
const PINNED_CAPS = { tag: 'caps' } as never

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
    mockedCaps,
  ]) {
    m.mockReset()
  }
  mockedCaps.mockResolvedValue(PINNED_CAPS)
  agentRowRef.rows = []
  mockedRuntime.mockResolvedValue({
    tools: [],
    model: { provider: 'p', model: 'm' },
    utilityModel: { provider: 'p', model: 'mu' },
    agentConfig: { appAccounts: {}, toolRestrictions: null },
  })
  mockedAgent.mockResolvedValue({
    kind: 'internal',
    procedures: [],
    activeVersionId: 'av1',
    activeVersionNumber: 3,
  })
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
    // Pinned runs record the active agent version; no draft config hash.
    expect(snap.agent.versionId).toBe('av1')
    expect(snap.agent.versionNumber).toBe(3)
    expect(snap.agentConfigHash).toBeUndefined()
  })

  it('compiles and pins the draft in draft mode, stamping runMode + content hash', async () => {
    mockedDraft.mockResolvedValue(ok({ draftDoc: { type: 'doc', content: [] } }))
    mockedCompile.mockReturnValue({ compiled: DRAFT_COMPILED, contentHash: 'dhash', errors: [] })
    agentRowRef.rows = [
      {
        prompt: {},
        toolsets: [],
        knowledge: [],
        appAccounts: {},
        toolRestrictions: {},
        modelId: null,
      },
    ]

    const result = await prepare('draft')
    expect(result.isOk()).toBe(true)
    const snap = result._unsafeUnwrap().runtimeSnapshot
    expect(snap.runMode).toBe('draft')
    expect(snap.draftContentHash).toBe('dhash')
    // The pinned versionId remains the record-keeping anchor; the compiled graph is the draft's.
    expect(snap.procedures).toEqual([{ id: 'p', versionId: 'v1', compiled: DRAFT_COMPILED }])
    // Draft runs stamp the row config hash and do NOT pin an agent version.
    expect(snap.agentConfigHash).toBeDefined()
    expect(snap.agent.versionId).toBeNull()
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

  it('resolves the PINNED version’s policy and hands it to the runtime builder (§9.1)', async () => {
    await prepare()

    // `source: 'active'` is the whole point: a pinned eval must execute under the
    // pinned version's `permissionPolicy` snapshot, not the mutable draft binding,
    // or the suite proves nothing about what the live agent may do.
    expect(mockedCaps).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org', source: 'active' })
    )
    // No `invokerUserId` — an eval is not a delegated human action, so the human
    // who clicked Run must not widen (or narrow) the agent's own authority.
    expect(mockedCaps.mock.calls[0]?.[0]).not.toHaveProperty('invokerUserId')
    expect(mockedRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ agentConfigSource: 'active', capabilities: PINNED_CAPS })
    )
  })

  it('resolves the DRAFT profile’s policy for a draft run — authority follows config', async () => {
    mockedDraft.mockResolvedValue(ok({ draftDoc: { type: 'doc', content: [] } }))
    mockedCompile.mockReturnValue({ compiled: DRAFT_COMPILED, contentHash: 'dhash', errors: [] })
    agentRowRef.rows = [
      {
        prompt: {},
        toolsets: [],
        knowledge: [],
        appAccounts: {},
        toolRestrictions: {},
        modelId: null,
      },
    ]

    await prepare('draft')

    expect(mockedCaps).toHaveBeenCalledWith(expect.objectContaining({ source: 'draft' }))
    expect(mockedRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ agentConfigSource: 'draft', capabilities: PINNED_CAPS })
    )
  })

  it('does not invent capabilities when the agent is not in the cache', async () => {
    mockedAgent.mockResolvedValue(null)

    await prepare()

    // No agent row → nothing to resolve. `undefined` is the pre-setup-draft
    // contract of `resolveAgentRunCapabilities`, not a silent all-access view.
    expect(mockedCaps).not.toHaveBeenCalled()
    expect(mockedRuntime).toHaveBeenCalledWith(expect.objectContaining({ capabilities: undefined }))
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
