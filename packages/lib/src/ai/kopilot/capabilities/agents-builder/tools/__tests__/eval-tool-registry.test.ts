// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/eval-tool-registry.test.ts
//
// Safety property, asserted over the REGISTERED capability (not just the
// factories): the eval write surface is exactly the two approval-gated tools —
// `create_eval_case` (authoring) and `update_eval_case_mock` (mock repair) — so
// no case is ever written or changed without a human approving the diff (phase
// 5C/5E). The eval tools also carry the expected approval/idempotency flags.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GetToolDeps } from '../../../types'

vi.mock('../../../../../../agents/procedures/authoring', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAgentProceduresForAuthoring: vi.fn(async () => ok([])),
}))
vi.mock('../../../../../../agents/toolset-catalog', () => ({
  getOrgToolsetCatalog: vi.fn(async () => []),
  getOrgToolsetCatalogForSurface: vi.fn(async () => []),
}))
vi.mock('../../../../../../cache', () => ({
  getCachedAgentById: vi.fn(async () => ({ kind: 'internal', procedures: [] })),
}))
vi.mock('../../../../context-refs', () => ({
  findRef: vi.fn(() => ({ id: 'a1' })),
}))

import { createAgentsBuilderCapabilities } from '../../index'

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: {},
    organizationId: 'org-1',
    userId: 'u-1',
    sessionId: 's-1',
  }) as never

describe('agents-builder eval tool registry (phase 5C/5E)', () => {
  let names: string[] = []
  let byName: Map<string, { requiresApproval?: boolean; idempotent?: boolean }>

  beforeEach(async () => {
    const capability = await createAgentsBuilderCapabilities(getDeps, 'org-1')
    names = capability.tools.map((t) => t.name)
    byName = new Map(capability.tools.map((t) => [t.name, t]))
  })

  it('registers the read tools, the suite trigger, and both write surfaces', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'list_eval_cases',
        'get_eval_case',
        'get_eval_run',
        'get_suite_diff',
        'run_eval_suite',
        'create_eval_case',
        'update_eval_case_mock',
      ])
    )
  })

  it('exposes exactly two eval write surfaces, both approval-gated', () => {
    const writes = names.filter((n) => /^(create|update|delete|set)_eval/.test(n)).sort()
    expect(writes).toEqual(['create_eval_case', 'update_eval_case_mock'])
    for (const name of writes) expect(byName.get(name)?.requiresApproval, name).toBe(true)
  })

  it('flags: reads are idempotent and ungated; writes require approval', () => {
    for (const name of ['list_eval_cases', 'get_eval_case', 'get_eval_run', 'get_suite_diff']) {
      expect(byName.get(name)?.idempotent, name).toBe(true)
      expect(byName.get(name)?.requiresApproval, name).toBeUndefined()
    }
    for (const name of ['run_eval_suite', 'create_eval_case', 'update_eval_case_mock']) {
      expect(byName.get(name)?.requiresApproval, name).toBe(true)
      expect(byName.get(name)?.idempotent, name).toBeUndefined()
    }
  })
})
