// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/__tests__/agent-authoring-guard.test.ts
//
// Security property, asserted by ENUMERATING the registered `agents.builder`
// capability set rather than per tool: every agent-builder meta-tool routes
// through `resolveAgentAuthoring` (`PermissionKey.agentsManage` + org-scope)
// before it does anything else.
//
// Why enumeration: these tools run below the tRPC routers, reached through
// `POST /api/kopilot/stream`, whose `page` and `context` come straight off the
// request body. A per-file test would let tool #18 ship with no authorization at
// all — which is exactly how `set_agent_prompt` / `set_agent_toolsets` /
// `set_agent_triggers` / `set_agent_resource_scope` / `update_agent_identity` /
// `complete_agent_setup` came to have none. The loop below fails the moment a
// newly registered tool skips the guard.
//
// The args passed are deliberately empty/garbage: the guard must run BEFORE
// argument validation, so a denial must surface even for a call the tool would
// otherwise reject on shape.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../../../../../../errors'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps } from '../../../types'

type ToolExecContext = Parameters<AgentToolDefinition['execute']>[1]

/** Run a tool's execute and narrow the (never-generator) builder result. */
function run(tool: AgentToolDefinition): Promise<AgentToolResult> {
  return tool.execute({} as never, agentDeps) as Promise<AgentToolResult>
}

// The gate is `PermissionKey.agentsManage` read off the caller's OWN
// `CapabilitySet` (plan 19 §2.4a relaxed it from OWNER/ADMIN once the author
// clamp landed), so the toggle under test is that one key — not a role.
const { getCapabilities, getCachedAgentById, capsRef } = vi.hoisted(() => {
  const capsRef = { canManageAgents: false, calledWith: [] as Array<[string, string]> }
  return {
    capsRef,
    getCapabilities: vi.fn(async (userId: string, orgId: string) => {
      capsRef.calledWith.push([orgId, userId])
      return { can: (_key: string) => capsRef.canManageAgents } as never
    }),
    getCachedAgentById: vi.fn(async (_org: string, _id: string) => ({}) as never),
  }
})

vi.mock('../../../../../../permissions/capabilities/get-capabilities', () => ({
  getCapabilities,
}))
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
// The feature gate must never be what denies a non-admin — a plan message would
// mask an authorization failure. Left permissive so any denial below is the
// OWNER/ADMIN / org-scope guard talking.
vi.mock('../../../../../../permissions', () => ({
  FeaturePermissionService: class {
    async requireAccess() {}
    async hasAccess() {
      return true
    }
  },
}))

import { createAgentsBuilderCapabilities } from '../../index'

const ORG = 'org-1'

/** A builder session with an `agent` ref, i.e. the shape a client can forge. */
const getDeps: GetToolDeps = () =>
  ({
    db: {},
    sessionContext: { page: 'agents.builder', references: [{ kind: 'agent', id: 'a1' }] },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
  }) as never

const agentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
} as ToolExecContext

async function builderToolNames(): Promise<string[]> {
  const capability = await createAgentsBuilderCapabilities(getDeps, ORG)
  return capability.tools.map((t) => t.name)
}

async function builderTools() {
  // `internal` kind so the branch that hides triggers / resource-scope from
  // chat agents doesn't shrink the enumerated set.
  const capability = await createAgentsBuilderCapabilities(getDeps, ORG)
  return capability.tools
}

describe('agents.builder tool registry — authorization enumeration', () => {
  beforeEach(() => {
    capsRef.canManageAgents = false
    capsRef.calledWith = []
    getCachedAgentById.mockReset().mockResolvedValue({ id: 'a1', kind: 'internal' } as never)
  })

  it('registers the six agent-configuration setters (the previously unguarded set)', async () => {
    capsRef.canManageAgents = true
    expect(await builderToolNames()).toEqual(
      expect.arrayContaining([
        'update_agent_identity',
        'set_agent_prompt',
        'set_agent_toolsets',
        'set_agent_triggers',
        'set_agent_resource_scope',
        'complete_agent_setup',
      ])
    )
  })

  it('EVERY registered tool refuses a member without agentsManage, with ForbiddenError', async () => {
    capsRef.canManageAgents = true
    const tools = await builderTools()
    expect(tools.length).toBeGreaterThan(0)

    // Drop the key only now — capability construction itself reads the agent,
    // and the gate under test is the per-tool execution gate.
    capsRef.canManageAgents = false
    capsRef.calledWith = []

    for (const tool of tools) {
      await expect(run(tool), tool.name).rejects.toThrow(ForbiddenError)
      // Resolved for THIS caller in THIS org — never a cached/global view.
      expect(capsRef.calledWith, tool.name).toContainEqual([ORG, 'member-1'])
    }
  })

  it('EVERY registered tool refuses an out-of-org agent ref, even with agentsManage', async () => {
    capsRef.canManageAgents = true
    const tools = await builderTools()

    // A crafted ref pointing at another workspace's agent isn't in this org's
    // `agents` cache entry. `updateAgent` and the toolset/trigger/scope services
    // key on `Agent.id` with no org predicate, so this is the only thing
    // standing between a forged ref and a cross-tenant write.
    getCachedAgentById.mockResolvedValue(null as never)

    for (const tool of tools) {
      await expect(run(tool), tool.name).rejects.toThrow(ForbiddenError)
    }
  })

  it('EVERY registered tool refuses (without throwing) when no agent ref is present', async () => {
    capsRef.canManageAgents = true
    const tools = await builderTools()

    const refless: GetToolDeps = () =>
      ({
        db: {},
        sessionContext: { references: [] },
        organizationId: ORG,
        userId: 'member-1',
        sessionId: 's-1',
      }) as never
    const capability = await createAgentsBuilderCapabilities(refless, ORG)

    for (const tool of capability.tools) {
      const result = await run(tool)
      expect(result.success, tool.name).toBe(false)
      expect(result.error, tool.name).toMatch(/No agent in session context/)
    }
    // The refless capability set must still cover every tool the ref'd one does,
    // so the assertion above isn't quietly checking a smaller registry.
    expect(capability.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort())
  })
})
