// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/procedure-create.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { createToolContext, runTool } from '../../../../../agent-framework/__test-helpers'
import type { GetToolDeps } from '../../../types'

// Force the auth guard to pass so we can exercise the tool's own logic.
vi.mock('../procedure-authoring-guard', () => ({
  resolveProcedureAuthoring: vi.fn(async () => ({ ok: true, agentId: 'a1' })),
}))
// Stub the schema-chip check (cache-backed) so it resolves clean.
vi.mock('../schema-references', () => ({
  validateSchemaReferences: vi.fn(async () => ({ unresolvedReferences: [], warnings: [] })),
}))
// Keep the real authoring pipeline (validate/build/compile) but stub the DB write.
vi.mock('../../../../../../agents/procedures/authoring', async (importActual) => {
  const actual =
    await importActual<typeof import('../../../../../../agents/procedures/authoring')>()
  return { ...actual, createAttachedProcedureDraft: vi.fn() }
})

import { createAttachedProcedureDraft } from '../../../../../../agents/procedures/authoring'
import { createCreateProcedureTool } from '../procedure-create'

const createDraftMock = createAttachedProcedureDraft as unknown as Mock

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never
const ctx = createToolContext({ organizationId: 'org-1', userId: 'u-1', sessionId: 's-1' })
const tool = createCreateProcedureTool(getDeps)

beforeEach(() => {
  createDraftMock.mockReset()
  createDraftMock.mockResolvedValue(ok({ procedureId: 'p1', draftContentHash: 'h1' }))
})

describe('create_procedure', () => {
  it('rejects an invalid body BEFORE any DB write', async () => {
    const result = await runTool(
      tool,
      { name: 'Bad', body: { steps: [{ id: 'x', kind: 'nonsense' }] } },
      ctx
    )
    expect(result.success).toBe(false)
    expect((result.output as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0)
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('rejects an opaque step on create (no prior draft to carry through)', async () => {
    const result = await runTool(
      tool,
      {
        name: 'X',
        body: { steps: [{ id: 'opaque:body:#0', kind: 'opaque', label: 'code block: X' }] },
      },
      ctx
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/opaque\/read-only/)
    expect(createDraftMock).not.toHaveBeenCalled()
  })

  it('creates a draft (no body) and attaches it', async () => {
    const result = await runTool(tool, { name: 'Refunds', whenToUse: 'refund asks' }, ctx)
    expect(result.success).toBe(true)
    expect((result.output as { procedureId: string }).procedureId).toBe('p1')
    expect(createDraftMock).toHaveBeenCalledOnce()
    expect(createDraftMock.mock.calls[0]![0]).toMatchObject({ agentId: 'a1', name: 'Refunds' })
  })

  it('compiles a valid body and seeds the draft doc', async () => {
    const body = {
      steps: [
        { id: 's1', kind: 'instruction', text: 'Greet.' },
        { id: 's2', kind: 'route', outcome: 'finished' },
      ],
    }
    const result = await runTool(tool, { name: 'Greeter', body }, ctx)
    expect(result.success).toBe(true)
    expect((result.output as { stepCount: number }).stepCount).toBeGreaterThan(0)
    // The DB write received a built doc (not the raw DSL).
    const call = createDraftMock.mock.calls[0]![0] as { doc?: { type?: string } }
    expect(call.doc?.type).toBe('doc')
  })
})
