// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/agent-authoring-instance-access.test.ts
//
// Per-AGENT access for the `agents.builder` meta-tools (plan 25 §4.2).
//
// The sibling `agent-authoring-guard.test.ts` pins that every tool runs the
// COARSE key + org-scope check. This file pins the third check that coarse key
// cannot make: **which agent**. Without it a member holding `agents: Full` with
// an explicit `none` row on one agent rewrites that agent's prompt through chat
// — the standing "requirePermission is coarse-key only" trap, one layer below
// the routers where it is easiest to miss.
//
// Enumerated, not per-tool, for the same reason the sibling file enumerates: a
// tool registered later must not be able to ship without a tier. `TIERS` is
// asserted to cover the registry exactly, so a new tool fails here until
// somebody decides what it costs.
//
// The capability set is a REAL `CapabilitySet`. The sibling file's fake is
// `{ can: () => boolean }` with no assert methods at all, which is why every one
// of its 63 cases passes even when the per-instance assert is replaced with an
// unconditional throw — verified before writing this.

import { ResourcePermission } from '@auxx/database/enums'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../../../../../../errors'
import { CapabilitySet } from '../../../../../../permissions/capabilities/capability-set'
import type { PermissionKey } from '../../../../../../permissions/capabilities/registry'
import {
  Area,
  expandLevelsToKeys,
  Level,
} from '../../../../../../permissions/capabilities/registry'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps } from '../../../types'

type ToolExecContext = Parameters<AgentToolDefinition['execute']>[1]

const ORG = 'org-1'
const AGENT_ID = 'a1'

/** Tool name → the per-agent tier it must require. */
const TIERS: Record<string, 'view' | 'edit' | 'admin'> = {
  // Reads
  get_eval_case: 'view',
  get_eval_run: 'view',
  get_suite_diff: 'view',
  list_eval_cases: 'view',
  read_procedure: 'view',
  // Authoring
  set_agent_prompt: 'edit',
  set_agent_toolsets: 'edit',
  set_agent_resource_scope: 'edit',
  create_eval_case: 'edit',
  update_eval_case_mock: 'edit',
  run_eval_suite: 'edit',
  create_procedure: 'edit',
  set_procedure_body: 'edit',
  update_procedure_criteria: 'edit',
  // Administration
  set_agent_triggers: 'admin',
  update_agent_identity: 'admin',
  complete_agent_setup: 'admin',
}

const RANK = { view: 0, edit: 1, admin: 2 } as const

const { capsRef, getCapabilities, getCachedAgentById } = vi.hoisted(() => {
  const capsRef = { caps: null as unknown }
  return {
    capsRef,
    getCapabilities: vi.fn(async () => capsRef.caps as never),
    getCachedAgentById: vi.fn(async () => ({ id: 'a1', kind: 'internal' }) as never),
  }
})

vi.mock('../../../../../../permissions/capabilities/get-capabilities', () => ({ getCapabilities }))
vi.mock('../../../../../../cache', () => ({
  getCachedAgentById,
  onCacheEvent: vi.fn(async () => {}),
}))
vi.mock('../../../../../../agents/procedures/authoring', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAgentProceduresForAuthoring: vi.fn(async () => ok([])),
}))
vi.mock('../../../../../../agents/toolset-catalog', () => ({
  getOrgToolsetCatalog: vi.fn(async () => []),
  getOrgToolsetCatalogForSurface: vi.fn(async () => []),
}))
// Permissive: a plan denial here would masquerade as an authorization failure.
vi.mock('../../../../../../permissions', () => ({
  FeaturePermissionService: class {
    async requireAccess() {}
    async hasAccess() {
      return true
    }
  },
}))

import { createAgentsBuilderCapabilities } from '../../index'

const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { page: 'agents.builder', references: [{ kind: 'agent', id: AGENT_ID }] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
  }) as never

const agentDeps = { organizationId: ORG, userId: 'member-1', sessionId: 's-1' } as ToolExecContext

/**
 * Area `agents: Full` throughout — so the ONLY thing that can deny is the
 * per-instance row. A test that lowered the area level too would pass even if
 * the instance check were deleted.
 */
function capsWithInstance(
  permission: ResourcePermission,
  areaLevel: Level = Level.Full
): CapabilitySet {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.agents]: areaLevel }) as PermissionKey[]),
    {},
    'MEMBER',
    'full',
    (id) => id,
    new Set(),
    (id) => id,
    { [AGENT_ID]: permission },
    new Set([AGENT_ID])
  )
}

async function builderTools(): Promise<AgentToolDefinition[]> {
  const capability = await createAgentsBuilderCapabilities(getDeps, ORG)
  return capability.tools
}

/** Did the guard deny this tool? Any non-Forbidden outcome counts as passing it. */
async function deniedByGuard(tool: AgentToolDefinition): Promise<boolean> {
  try {
    await (tool.execute({} as never, agentDeps) as Promise<AgentToolResult>)
    return false
  } catch (error) {
    return error instanceof ForbiddenError
  }
}

beforeEach(() => {
  capsRef.caps = capsWithInstance(ResourcePermission.admin)
  getCachedAgentById.mockClear()
})

describe('agents.builder tools — every tool declares a per-agent tier', () => {
  it('TIERS covers the registry exactly, so a new tool cannot ship without one', async () => {
    capsRef.caps = capsWithInstance(ResourcePermission.admin)
    const names = (await builderTools()).map((t) => t.name).sort()
    expect(names).toEqual(Object.keys(TIERS).sort())
  })
})

describe('agents.builder tools — an explicit `none` row beats the whole area', () => {
  it('denies EVERY tool for a member holding agents: Full but restricted on this agent', async () => {
    capsRef.caps = capsWithInstance(ResourcePermission.admin)
    const tools = await builderTools()
    expect(tools.length).toBeGreaterThan(0)

    capsRef.caps = capsWithInstance(ResourcePermission.none)
    for (const tool of tools) {
      expect(await deniedByGuard(tool), tool.name).toBe(true)
    }
  })
})

describe('agents.builder tools — each tier admits exactly its own rung and above', () => {
  for (const [grant, granted] of [
    [ResourcePermission.view, 'view'],
    [ResourcePermission.edit, 'edit'],
    [ResourcePermission.admin, 'admin'],
  ] as const) {
    it(`an instance \`${granted}\` holder reaches the ${granted}-and-below tools and no others`, async () => {
      capsRef.caps = capsWithInstance(ResourcePermission.admin)
      const tools = await builderTools()

      capsRef.caps = capsWithInstance(grant)
      for (const tool of tools) {
        const required = TIERS[tool.name]
        if (!required) throw new Error(`no tier declared for ${tool.name}`)
        const shouldDeny = RANK[required] > RANK[granted]
        expect(await deniedByGuard(tool), `${tool.name} (needs ${required}, has ${granted})`).toBe(
          shouldDeny
        )
      }
    })
  }
})

describe('agents.builder tools — the Kopilot path is no cheaper than the tRPC path', () => {
  it('keeps `set_agent_triggers` at admin, matching agent-trigger.ts', async () => {
    // The specific bypass a single shared tier would have created: triggers are
    // `assertAdminInstance` on the router because they make the agent act
    // autonomously on its own credentials, so an instance-`edit` holder must not
    // reach them through chat instead.
    capsRef.caps = capsWithInstance(ResourcePermission.admin)
    const tools = await builderTools()
    const triggers = tools.find((t) => t.name === 'set_agent_triggers')
    if (!triggers) throw new Error('set_agent_triggers is not registered')

    capsRef.caps = capsWithInstance(ResourcePermission.edit)
    expect(await deniedByGuard(triggers)).toBe(true)
  })

  it('takes the COARSE rung from the tier too, so a read tool needs only agents.view', async () => {
    // The guard runs two checks per tier: the area rung, then the instance row.
    // Every other case here grants `agents: Full`, which holds all three keys —
    // so the area half is invisible to them and a mutation hardcoding
    // `agentsManage` there survives. This is the case that kills it: a member
    // whose AREA level is only Read must still reach the read tools, exactly as
    // `agentToolset.listTools` moved to `agentsView` on the router side.
    capsRef.caps = capsWithInstance(ResourcePermission.admin)
    const tools = await builderTools()
    const read = tools.find((t) => t.name === 'get_eval_case')
    const write = tools.find((t) => t.name === 'set_agent_prompt')
    if (!read || !write) throw new Error('expected tools are not registered')

    capsRef.caps = capsWithInstance(ResourcePermission.admin, Level.Read)
    expect(await deniedByGuard(read)).toBe(false)
    // …and the area rung still binds upward: Read is not enough to author.
    expect(await deniedByGuard(write)).toBe(true)
  })

  it('lets an instance `view` holder read an eval case but not create one', async () => {
    capsRef.caps = capsWithInstance(ResourcePermission.admin)
    const tools = await builderTools()
    const read = tools.find((t) => t.name === 'get_eval_case')
    const write = tools.find((t) => t.name === 'create_eval_case')
    if (!read || !write) throw new Error('eval tools are not registered')

    capsRef.caps = capsWithInstance(ResourcePermission.view)
    expect(await deniedByGuard(read)).toBe(false)
    expect(await deniedByGuard(write)).toBe(true)
  })
})
