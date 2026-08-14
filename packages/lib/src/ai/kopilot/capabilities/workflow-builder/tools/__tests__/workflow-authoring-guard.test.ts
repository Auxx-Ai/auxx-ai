// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/workflow-authoring-guard.test.ts
//
// Security property, asserted by ENUMERATING the registered `workflow.builder`
// capability set (the agents-builder pattern): every tool that touches the
// workflow routes through `resolveWorkflowAuthoring` before it does anything
// else — fail-closed on absent capabilities, area rung, org scope, per-workflow
// instance rung, system-owned lockdown, and (for mutations) the dirty gate.
//
// The args passed on denial cases are deliberately empty/garbage: the guard
// must run BEFORE argument validation, so a denial must surface even for a
// call the tool would otherwise reject on shape.

import { err, ok, type Result } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AuxxError, BadRequestError, ForbiddenError } from '../../../../../../errors'
import type { GraphMutationResult } from '../../../../../../workflows/graph-edit/types'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const assertNotSystemOwned = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../../../../../workflows/workflow-app-access-guard', () => ({
  assertWorkflowAppNotSystemOwned: (...args: unknown[]) => assertNotSystemOwned(...args),
}))

const APPLIED: GraphMutationResult = {
  applied: true,
  node: {
    ref: 'Wait A Bit',
    id: 'wait-1',
    type: 'wait',
    title: 'Wait A Bit',
    position: { x: 10, y: 20 },
    config: { waitFor: '10m' },
  },
  outputs: [{ id: 'Wait A Bit.done', label: 'Done', type: 'boolean' }] as never,
  issues: [],
  graphSummary: { nodeCount: 2, edgeCount: 1, nodes: [], edges: [], triggerType: 'manual' },
}

const opMock = vi.fn(
  async (..._args: unknown[]): Promise<Result<GraphMutationResult, AuxxError>> => ok(APPLIED)
)
const readDraftMock = vi.fn(async (..._args: unknown[]) =>
  ok({
    workflowAppId: 'wfapp-1',
    name: 'My Flow',
    triggerType: 'manual',
    nodes: [],
    edges: [],
    outputs: {},
    issues: [],
    graphSummary: { nodeCount: 0, edgeCount: 0, nodes: [], edges: [], triggerType: 'manual' },
  })
)
vi.mock('../../../../../../workflows/graph-edit', () => ({
  addNode: (...a: unknown[]) => opMock(...a),
  updateNode: (...a: unknown[]) => opMock(...a),
  deleteNodes: (...a: unknown[]) => opMock(...a),
  connectNodes: (...a: unknown[]) => opMock(...a),
  disconnectNodes: (...a: unknown[]) => opMock(...a),
  setTrigger: (...a: unknown[]) => opMock(...a),
  replaceGraph: (...a: unknown[]) => opMock(...a),
  applyTemplate: (...a: unknown[]) => opMock(...a),
  readDraft: (...a: unknown[]) => readDraftMock(...a),
  validateWorkflow: vi.fn(async () =>
    ok({ publishable: true, publishErrors: [], publishWarnings: [], issues: [] })
  ),
}))

const runNodeMock = vi.fn(async (..._args: unknown[]) =>
  ok({ status: 'succeeded' as const, outputs: { done: true }, error: null, elapsedTime: 0.1 })
)
vi.mock('../../../../../../workflows/graph-edit/run-node', () => ({
  runNode: (...a: unknown[]) => runNodeMock(...a),
}))

vi.mock('../../../../../../workflows/graph-edit/turn-snapshot', () => ({
  readWorkflowTurnSnapshot: vi.fn(async () => null),
  revertWorkflowTurn: vi.fn(async () => ok({ graphHash: 'h' })),
}))

vi.mock('../../../../../../demo', () => ({
  DemoGuard: { requireNotDemo: vi.fn(async () => {}) },
}))

vi.mock('@auxx/services/workflow-templates', () => ({
  getAllTemplates: vi.fn(async () => ok([])),
}))

import { createWorkflowBuilderCapabilities } from '../../index'
import { DIRTY_CANVAS_ERROR, NO_WORKFLOW_REF_ERROR } from '../workflow-authoring-guard'

// ── Fixture ──────────────────────────────────────────────────────────────────

const ORG = 'org-1'
const WF = 'wfapp-1'

type CapsStub = {
  can: ReturnType<typeof vi.fn>
  canViewInstance: ReturnType<typeof vi.fn>
  assertEditInstance: ReturnType<typeof vi.fn>
}

function makeCaps(): CapsStub {
  return {
    can: vi.fn(() => true),
    canViewInstance: vi.fn(() => true),
    assertEditInstance: vi.fn(() => {}),
  }
}

/** Rows the guard's org-scope select resolves. */
let appRows: Array<{ id: string }> = [{ id: WF }]
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => appRows }) }),
  }),
}

let caps: CapsStub | undefined
let refs: Array<Record<string, unknown>> = [{ kind: 'workflow', id: WF }]

const getDeps: GetToolDeps = () =>
  ({
    db,
    sessionContext: { page: 'workflow.builder', references: refs },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: caps,
  }) as unknown as ToolDeps

const agentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
  turnId: 'turn-1',
} as Parameters<AgentToolDefinition['execute']>[1]

function tools(): AgentToolDefinition[] {
  return createWorkflowBuilderCapabilities(getDeps).tools
}

function tool(name: string): AgentToolDefinition {
  const found = tools().find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not registered`)
  return found
}

/** Minimal shape-valid args so success-path tests get past arg validation. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  get_workflow: {},
  get_node: { ref: 'Wait A Bit' },
  validate_workflow: {},
  add_node: { type: 'wait' },
  update_node: { ref: 'Wait A Bit', config: { waitFor: '5m' } },
  delete_nodes: { refs: ['Wait A Bit'] },
  connect_nodes: { from: 'A', to: 'B' },
  disconnect_nodes: { from: 'A', to: 'B' },
  set_trigger: { triggerType: 'manual' },
  replace_graph: { nodes: [{ type: 'wait' }], edges: [] },
  apply_template: { templateId: 'file:x' },
  run_node: { ref: 'Wait A Bit' },
}

function run(t: AgentToolDefinition, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  return t.execute(args as never, agentDeps) as Promise<AgentToolResult>
}

const MUTATION_TOOLS = [
  'add_node',
  'update_node',
  'delete_nodes',
  'connect_nodes',
  'disconnect_nodes',
  'set_trigger',
  'replace_graph',
  'apply_template',
] as const
const VIEW_TOOLS = ['get_workflow', 'get_node', 'validate_workflow'] as const
const GUARDED = [...VIEW_TOOLS, ...MUTATION_TOOLS, 'run_node'] as const
const DISCOVERY = ['list_node_types', 'describe_node_type', 'find_workflow_templates'] as const

beforeEach(() => {
  caps = makeCaps()
  refs = [{ kind: 'workflow', id: WF }]
  appRows = [{ id: WF }]
  assertNotSystemOwned.mockReset().mockResolvedValue(undefined)
  opMock.mockClear()
  readDraftMock.mockClear()
  runNodeMock.mockClear()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('workflow.builder tool registry', () => {
  it('registers exactly the specced tool set — no publish/enable/delete_workflow, no run-workflow', () => {
    const names = tools().map((t) => t.name)
    expect(names.sort()).toEqual([...GUARDED, ...DISCOVERY].sort())
    for (const forbidden of [
      'publish_workflow',
      'enable_workflow',
      'delete_workflow',
      'run_workflow',
    ]) {
      expect(names).not.toContain(forbidden)
    }
  })

  it('every tool is builder-surface only and carries the toolset slug', () => {
    for (const t of tools()) {
      expect(t.surfaces, t.name).toEqual(['builder'])
      expect(t.toolsetSlug, t.name).toBe('workflow.builder')
      expect(t.permission, t.name).toBeDefined()
    }
  })

  it('run_node requires approval', () => {
    expect(tool('run_node').requiresApproval).toBe(true)
  })
})

describe('workflow.builder authorization enumeration', () => {
  it('every guarded tool refuses without a workflow ref (bad context, not a throw)', async () => {
    refs = []
    for (const name of GUARDED) {
      const result = await run(tool(name))
      expect(result.success, name).toBe(false)
      expect(result.error, name).toBe(NO_WORKFLOW_REF_ERROR)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('FAIL CLOSED: every guarded tool throws ForbiddenError when capabilities are absent', async () => {
    caps = undefined
    for (const name of GUARDED) {
      await expect(run(tool(name)), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('every guarded tool throws ForbiddenError without the workflows area rung', async () => {
    caps!.can.mockReturnValue(false)
    for (const name of GUARDED) {
      await expect(run(tool(name)), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('a crafted foreign-org ref reads as "not in this workspace" — silent for reads, thrown for writes', async () => {
    appRows = [] // the org-scoped select finds nothing
    for (const name of VIEW_TOOLS) {
      const result = await run(tool(name), VALID_ARGS[name])
      expect(result.success, name).toBe(false)
      expect(result.error, name).toMatch(/not found in this workspace/i)
    }
    for (const name of [...MUTATION_TOOLS, 'run_node']) {
      await expect(run(tool(name), VALID_ARGS[name]), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
    expect(runNodeMock).not.toHaveBeenCalled()
  })

  it('per-workflow instance rung: reads filter silently, writes throw', async () => {
    caps!.canViewInstance.mockReturnValue(false)
    const read = await run(tool('get_workflow'))
    expect(read.success).toBe(false)
    expect(read.error).toMatch(/not found/i)

    caps!.assertEditInstance.mockImplementation(() => {
      throw new ForbiddenError('nope')
    })
    await expect(run(tool('add_node'), VALID_ARGS.add_node)).rejects.toThrow(ForbiddenError)
    expect(caps!.assertEditInstance).toHaveBeenCalledWith('workflow', WF)
  })

  it('system-owned workflows stay blind on reads and forbidden on writes', async () => {
    assertNotSystemOwned.mockRejectedValue(new ForbiddenError('system-owned'))
    const read = await run(tool('get_workflow'))
    expect(read.success).toBe(false)
    expect(read.error).toMatch(/not found/i)
    await expect(run(tool('add_node'), VALID_ARGS.add_node)).rejects.toThrow(ForbiddenError)
  })
})

describe('dirty gate', () => {
  it('every mutation refuses while the chip reports unsaved canvas changes', async () => {
    refs = [{ kind: 'workflow', id: WF, isDirty: true }]
    for (const name of MUTATION_TOOLS) {
      const result = await run(tool(name), VALID_ARGS[name])
      expect(result.success, name).toBe(false)
      expect(result.error, name).toBe(DIRTY_CANVAS_ERROR)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('reads and run_node still work while dirty', async () => {
    refs = [{ kind: 'workflow', id: WF, isDirty: true }]
    expect((await run(tool('get_workflow'))).success).toBe(true)
    expect((await run(tool('run_node'), VALID_ARGS.run_node)).success).toBe(true)
  })

  it('tolerates the flag being absent — mutations proceed', async () => {
    refs = [{ kind: 'workflow', id: WF }]
    const result = await run(tool('add_node'), VALID_ARGS.add_node)
    expect(result.success).toBe(true)
    expect(opMock).toHaveBeenCalledTimes(1)
  })
})

describe('turn scoping', () => {
  it('a mutation without a turnId is refused — no snapshot means no Undo', async () => {
    const noTurn = { ...agentDeps, turnId: undefined } as typeof agentDeps
    const result = (await tool('add_node').execute(
      VALID_ARGS.add_node as never,
      noTurn
    )) as AgentToolResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/turnId/)
    expect(opMock).not.toHaveBeenCalled()
  })
})

describe('discovery tools', () => {
  it('list_node_types works without any workflow context and flags authorable types', async () => {
    refs = []
    caps = undefined
    const result = await run(tool('list_node_types'))
    expect(result.success).toBe(true)
    const types = (result.output as { types: Array<{ type: string; authorable: boolean }> }).types
    expect(types.length).toBeGreaterThan(10)
    expect(types.every((t) => typeof t.authorable === 'boolean')).toBe(true)
  })

  it('describe_node_type returns the agent-facing schema and connection rules', async () => {
    const result = await run(tool('describe_node_type'), { type: 'wait' })
    expect(result.success).toBe(true)
    const out = result.output as Record<string, unknown>
    expect(out.type).toBe('wait')
    expect(out.configSchema).toBeTruthy()
    expect(out.connection).toBeTruthy()
  })

  it('describe_node_type refuses an unknown type honestly, naming it', async () => {
    const result = await run(tool('describe_node_type'), { type: 'quantum-blockchain' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('quantum-blockchain')
  })
})

describe('non-authorable / unknown types surface graph-edit’s honest refusal verbatim', () => {
  it('add_node passes the authorable-set error through, never substituting a type', async () => {
    opMock.mockResolvedValueOnce(
      err(
        new BadRequestError(
          'Node type "webhook-endpoint" cannot be authored here. Authorable types: ai, wait.'
        )
      )
    )
    const result = await run(tool('add_node'), { type: 'webhook-endpoint' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('webhook-endpoint')
    expect(result.error).toContain('Authorable types')
  })
})
