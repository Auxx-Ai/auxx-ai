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
    configHash: 'config-hash-1',
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

const captureWorkflowTurnSnapshot = vi.fn(async () => true)
vi.mock('../../../../../../workflows/graph-edit/turn-snapshot', () => ({
  captureWorkflowTurnSnapshot,
  readWorkflowTurnSnapshot: vi.fn(async () => null),
  revertWorkflowTurn: vi.fn(async () => ok({ graphHash: 'h' })),
}))

const beginWorkflowTurnLock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('../../../../../../workflows/graph-edit/turn-lock', () => ({
  beginWorkflowTurnLock: (...a: unknown[]) => beginWorkflowTurnLock(...a),
}))

const loadDraftContext = vi.fn(async () =>
  ok({
    workflowAppId: 'wfapp-1',
    organizationId: 'org-1',
    appName: 'My Flow',
    appDescription: 'Original description',
    draftRow: null,
    graph: { nodes: [], edges: [] },
    triggerType: 'manual',
  })
)
vi.mock('../../../../../../workflows/graph-edit/read', () => ({
  loadDraftContext,
}))

const updateWorkflowDetails = vi.fn(
  async (_organizationId: string, _input: Record<string, unknown>) => ({
    name: 'Renamed workflow',
    description: 'New description',
  })
)
vi.mock('../../../../../../workflows/workflow-service', () => ({
  WorkflowService: class {
    update(organizationId: string, input: Record<string, unknown>) {
      return updateWorkflowDetails(organizationId, input)
    }
  },
}))

const publishDraftUpdatedSignal = vi.fn(async () => {})
vi.mock('../../../../../../workflows/graph-edit/persist', () => ({
  publishDraftUpdatedSignal,
}))

vi.mock('../../../../../../demo', () => ({
  DemoGuard: { requireNotDemo: vi.fn(async () => {}) },
}))

vi.mock('@auxx/services/workflow-templates', () => ({
  getAllTemplates: vi.fn(async () => ok([])),
}))

/**
 * The installed-app fleet `list_app_blocks` lists and `buildManifestLookup`
 * synthesizes from. Two apps on purpose: one contributing a block, one
 * contributing none — the second is what proves the list is per-BLOCK, not
 * per-app.
 */
const installedApps = vi.fn(async (..._a: unknown[]) => [
  {
    installationId: 'inst-1',
    app: { id: 'appfedex', slug: 'fedex', title: 'Fedex', description: null, avatarUrl: null },
    orgConnectionPresent: false,
    orgConnectionExpiresAt: null,
    methods: [{ id: 'cd-1', key: 'oauth2', label: 'FedEx account', global: true }],
    workflowBlocks: [
      {
        id: 'fedex',
        label: 'FedEx',
        description: 'Track FedEx shipments',
        requiresConnection: true,
        ops: [
          { key: 'shipment.track', resource: 'shipment', operation: 'track', toolId: 't1' },
          { key: 'shipment.watch', resource: 'shipment', operation: 'watch', toolId: 't2' },
        ],
      },
    ],
  },
  {
    installationId: 'inst-2',
    app: { id: 'apphub', slug: 'hubspot', title: 'HubSpot', description: null, avatarUrl: null },
    orgConnectionPresent: true,
    orgConnectionExpiresAt: null,
    workflowBlocks: [],
  },
])
vi.mock('../../../../../../cache', () => ({
  getCachedInstalledApps: (...a: unknown[]) => installedApps(...a),
}))

/**
 * Every `kind:'app'` credential in the org — personal rows and other apps'
 * rows included, because filtering them out is `list_app_connections`' job and
 * a fixture that pre-filters would prove nothing.
 */
const appConnections = vi.fn(async (..._a: unknown[]) =>
  ok([
    {
      id: 'cred-primary',
      appId: 'appfedex',
      appName: 'Fedex',
      label: 'FedEx (workspace)',
      connectionStatus: 'connected',
      global: true,
      userId: null,
      isDefault: true,
      connectionVariables: { accountNumber: '4711', shopDomain: 'acme.example' },
    },
    {
      id: 'cred-secondary',
      appId: 'appfedex',
      appName: 'Fedex',
      label: 'FedEx EU',
      connectionStatus: 'expired',
      global: true,
      userId: null,
    },
    {
      id: 'cred-personal',
      appId: 'appfedex',
      appName: 'Fedex',
      label: "Markus's FedEx",
      connectionStatus: 'connected',
      global: false,
      userId: 'user-1',
    },
    {
      id: 'cred-otherapp',
      appId: 'apphub',
      appName: 'HubSpot',
      label: 'HubSpot (workspace)',
      connectionStatus: 'connected',
      global: true,
      userId: null,
    },
  ])
)
vi.mock('@auxx/services/app-connections', () => ({
  listAppConnections: (...a: unknown[]) => appConnections(...a),
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
  assertAdminInstance: ReturnType<typeof vi.fn>
}

function makeCaps(): CapsStub {
  return {
    can: vi.fn(() => true),
    canViewInstance: vi.fn(() => true),
    assertEditInstance: vi.fn(() => {}),
    assertAdminInstance: vi.fn(() => {}),
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
  set_workflow_details: { name: 'Renamed workflow' },
  run_node: { ref: 'Wait A Bit' },
  list_app_blocks: {},
  list_app_connections: { appSlug: 'fedex' },
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
  'set_workflow_details',
] as const
const VIEW_TOOLS = [
  'get_workflow',
  'get_node',
  'validate_workflow',
  'list_app_blocks',
  'list_app_connections',
] as const
const GUARDED = [...VIEW_TOOLS, ...MUTATION_TOOLS, 'run_node'] as const
/**
 * Discovery splits in two now.
 *
 * `describe_node_type` answers for app-block types, which are per-ORG installed
 * data, so it takes the `workflowsView` area rung — but NOT a workflow ref: it
 * is addressed by type id and there is no instance to gate on. It is therefore
 * in neither bucket, and `AREA_ONLY` names that third state explicitly rather
 * than letting it fall out of the enumeration unnoticed.
 */
const UNGATED_DISCOVERY = ['list_node_types', 'find_workflow_templates'] as const
const AREA_ONLY = ['describe_node_type'] as const
const DISCOVERY = [...UNGATED_DISCOVERY, ...AREA_ONLY] as const

beforeEach(() => {
  caps = makeCaps()
  refs = [{ kind: 'workflow', id: WF }]
  appRows = [{ id: WF }]
  assertNotSystemOwned.mockReset().mockResolvedValue(undefined)
  opMock.mockClear()
  readDraftMock.mockClear()
  runNodeMock.mockClear()
  captureWorkflowTurnSnapshot.mockClear()
  loadDraftContext.mockClear()
  updateWorkflowDetails.mockClear()
  publishDraftUpdatedSignal.mockClear()
  beginWorkflowTurnLock.mockClear()
  installedApps.mockClear()
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

  // The `toolsetSlug` assertion here used to require `'workflow.builder'`, and
  // it pinned the bug rather than catching it: master Kopilot's toolsets come
  // from the `kopilot.toolsets` setting (default glob `auxx:*`, which cannot
  // match a slug outside that namespace), so `filterToolsByToolsets` stripped
  // every one of these tools after registration. They mount by PAGE context,
  // like the agents-builder tools, and must stay slug-free.
  it('every tool is builder-surface only and mounts by page, not by toolset', () => {
    for (const t of tools()) {
      expect(t.surfaces, t.name).toEqual(['builder'])
      expect(t.toolsetSlug, t.name).toBeUndefined()
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

  /**
   * `describe_node_type` answers for app-block types, which are per-org, so it
   * must not stay ungated — but it takes no workflow ref, so the enumeration
   * above cannot cover it. Asserted here on both rungs, and asserted to still
   * work WITHOUT a workflow ref, because losing that would break every
   * off-builder caller for no security gain.
   */
  it('area-only tools take the workflows rung but need no workflow ref', async () => {
    refs = []
    for (const name of AREA_ONLY) {
      const allowed = await run(tool(name), VALID_ARGS[name] ?? { type: 'wait' })
      expect(allowed.success, name).toBe(true)

      caps = undefined
      await expect(run(tool(name), { type: 'wait' }), name).rejects.toThrow(ForbiddenError)

      caps = makeCaps()
      caps.can.mockReturnValue(false)
      await expect(run(tool(name), { type: 'wait' }), name).rejects.toThrow(ForbiddenError)
      caps = makeCaps()
    }
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

  it('workflow details require the admin instance rung', async () => {
    caps!.assertAdminInstance.mockImplementation(() => {
      throw new ForbiddenError('admin required')
    })
    await expect(
      run(tool('set_workflow_details'), VALID_ARGS.set_workflow_details)
    ).rejects.toThrow(ForbiddenError)
    expect(caps!.assertAdminInstance).toHaveBeenCalledWith('workflow', WF)
  })

  it('updates workflow details with a turn snapshot and a draft refresh', async () => {
    const result = await run(tool('set_workflow_details'), {
      name: 'Renamed workflow',
      description: 'New description',
    })

    expect(result).toMatchObject({
      success: true,
      output: { name: 'Renamed workflow', description: 'New description' },
    })
    expect(caps!.assertAdminInstance).toHaveBeenCalledWith('workflow', WF)
    expect(captureWorkflowTurnSnapshot).toHaveBeenCalledWith(WF, 'turn-1', {
      graph: { nodes: [], edges: [] },
      triggerType: 'manual',
      name: 'My Flow',
      description: 'Original description',
    })
    expect(updateWorkflowDetails).toHaveBeenCalledWith(ORG, {
      id: WF,
      name: 'Renamed workflow',
      description: 'New description',
      preserveTurnSnapshot: true,
    })
    expect(publishDraftUpdatedSignal).toHaveBeenCalledWith(ORG, {
      workflowAppId: WF,
      reason: 'kopilot',
    })
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

// The canvas edit lock (plan 14 §6.7). Claimed by the shared gate rather than
// per-tool, so every graph tool locks the canvas identically.
describe('canvas edit lock', () => {
  it('is claimed on READ tools too, not just mutations', async () => {
    // Locking only on the first mutation would leave the window this closes:
    // the dirty gate reads `isDirty` off the ref captured at message SEND, so a
    // user who dirties the canvas mid-turn is invisible to it.
    await run(tool('get_workflow'), VALID_ARGS.get_workflow)
    expect(beginWorkflowTurnLock).toHaveBeenCalledWith(ORG, WF, expect.any(String))
  })

  it('is claimed on mutations', async () => {
    await run(tool('add_node'), VALID_ARGS.add_node)
    expect(beginWorkflowTurnLock).toHaveBeenCalledWith(ORG, WF, expect.any(String))
  })

  // An unauthorized caller must never be able to move the lock — that would let
  // any authenticated member freeze another member's canvas by POSTing a
  // crafted workflow ref at the stream route.
  it('is NOT claimed when authorization fails', async () => {
    caps!.can.mockReturnValue(false)
    await expect(run(tool('add_node'), VALID_ARGS.add_node)).rejects.toThrow(ForbiddenError)
    expect(beginWorkflowTurnLock).not.toHaveBeenCalled()
  })

  it('is NOT claimed without a workflow ref', async () => {
    refs = []
    await run(tool('get_workflow'), VALID_ARGS.get_workflow)
    expect(beginWorkflowTurnLock).not.toHaveBeenCalled()
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

  it('list_node_types searches id, display name, description, and category', async () => {
    const byId = await run(tool('list_node_types'), { query: 'if-else' })
    expect(byId.success).toBe(true)
    expect((byId.output as { types: Array<{ type: string }> }).types.map((t) => t.type)).toEqual([
      'if-else',
    ])

    const byDescription = await run(tool('list_node_types'), { query: 'HTTP REQUESTS' })
    expect(byDescription.success).toBe(true)
    expect(
      (byDescription.output as { types: Array<{ type: string }> }).types.map((t) => t.type)
    ).toContain('http')

    const byCategory = await run(tool('list_node_types'), {
      category: 'utility',
      query: 'date',
    })
    expect(byCategory.success).toBe(true)
    expect((byCategory.output as { types: Array<{ type: string }> }).types).toHaveLength(1)
  })

  it('list_node_types reports an actionable error when filters match nothing', async () => {
    const result = await run(tool('list_node_types'), { query: 'quantum-blockchain' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('quantum-blockchain')
    expect(result.error).toContain('without filters')
  })

  it('read and discovery tools build compact count digests', () => {
    expect(tool('list_node_types').buildDigest?.({ types: [{}, {}] })).toEqual({
      label: 'Node types listed',
      resultCount: 2,
    })
    expect(tool('find_workflow_templates').buildDigest?.({ templates: [{}] })).toEqual({
      label: 'Workflow templates found',
      resultCount: 1,
    })
    expect(tool('get_workflow').buildDigest?.({ nodeCount: 4, nodes: [] })).toEqual({
      label: 'Workflow loaded',
      nodeCount: 4,
    })
    expect(
      tool('validate_workflow').buildDigest?.({
        publishErrors: ['Missing trigger'],
        publishWarnings: ['Unused node'],
        issues: [
          { severity: 'error', message: 'Missing trigger' },
          { severity: 'error', message: 'Broken reference' },
          { severity: 'warning', message: 'Unused node' },
        ],
      })
    ).toEqual({ label: 'Workflow validated', errorCount: 2, warningCount: 1 })
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

  /**
   * The §9.1 blocker: before this, `describe_node_type` read the CORE registry
   * only, so the one tool an agent calls before configuring an unfamiliar type
   * told it every app-block type did not exist — and it then refused to write a
   * node the write path would have accepted.
   */
  it('describe_node_type resolves an app-block type, with its operation vocabulary', async () => {
    const result = await run(tool('describe_node_type'), { type: 'appfedex:fedex' })
    expect(result.success).toBe(true)
    const out = result.output as Record<string, any>
    expect(out.type).toBe('appfedex:fedex')
    expect(out.authorable).toBe(true)
    // The vocabulary the agent could not otherwise reach — an enum, because the
    // synthesized manifest declares `operation` as `z.enum` over the real ops.
    expect(out.configSchema.properties.operation.enum).toEqual(['track', 'watch'])
    expect(out.configSchema.properties.resource.enum).toEqual(['shipment'])
    expect(out.usage).toContain('shipment.track')
  })

  it('describe_node_type does not read the org cache for a core type', async () => {
    await run(tool('describe_node_type'), { type: 'wait' })
    expect(installedApps).not.toHaveBeenCalled()
  })

  it('describe_node_type gives a colon type the app-block-shaped refusal', async () => {
    const result = await run(tool('describe_node_type'), { type: 'jira:issue' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('shaped like an app block')
    expect(result.error).toContain('list_app_blocks')
  })

  it('list_app_blocks lists one row per installed BLOCK, not per app', async () => {
    const result = await run(tool('list_app_blocks'))
    expect(result.success).toBe(true)
    const blocks = (result.output as { blocks: Array<Record<string, unknown>> }).blocks
    // HubSpot is installed but contributes no block — it must not appear.
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      type: 'appfedex:fedex',
      app: 'Fedex',
      appSlug: 'fedex',
      label: 'FedEx',
      resources: ['shipment'],
      operationCount: 2,
      requiresConnection: true,
      connected: false,
    })
    // The vocabulary is describe_node_type's job — quickbooks declares 42
    // operations and shopify 64, so listing them here would swamp the answer.
    expect(blocks[0]).not.toHaveProperty('operations')
  })

  it('list_app_blocks searches app, label, description and operation names (unemitted)', async () => {
    for (const query of ['fedex', 'FEDEX SHIPMENTS', 'shipment.watch', 'appfedex:fedex']) {
      const result = await run(tool('list_app_blocks'), { query })
      expect(result.success, query).toBe(true)
      expect((result.output as { blocks: unknown[] }).blocks, query).toHaveLength(1)
    }
  })

  it('list_app_blocks reports an actionable error when nothing matches', async () => {
    const result = await run(tool('list_app_blocks'), { query: 'quantum-blockchain' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('quantum-blockchain')
    expect(result.error).toContain('without a query')
  })

  it('list_app_blocks says so when no installed app contributes a block', async () => {
    installedApps.mockResolvedValueOnce([])
    const result = await run(tool('list_app_blocks'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('No app installed in this workspace')
  })

  /**
   * `requiresConnection: undefined` means UNKNOWN — a catalog published before
   * the field existed simply does not say. Emitting `false` there would let the
   * agent read a guess as a fact, so the key is omitted instead.
   */
  it('list_app_blocks omits requiresConnection rather than guessing false', async () => {
    installedApps.mockResolvedValueOnce([
      {
        installationId: 'inst-3',
        app: { id: 'appold', slug: 'old', title: 'Old', description: null, avatarUrl: null },
        orgConnectionPresent: true,
        orgConnectionExpiresAt: null,
        workflowBlocks: [{ id: 'blk', label: 'Blk', description: 'd', ops: [] }],
      },
    ] as never)
    const result = await run(tool('list_app_blocks'))
    expect(result.success).toBe(true)
    const blocks = (result.output as { blocks: Array<Record<string, unknown>> }).blocks
    expect(blocks[0]).not.toHaveProperty('requiresConnection')
    expect(blocks[0]!.connected).toBe(true)
  })

  it('list_app_connections lists ONLY workspace rows for the named app', async () => {
    // The three exclusions in one assertion: another app's row, a personal
    // row, and — the one that matters — every field that is not one of the
    // five. `connectionVariables` is plaintext but carries account numbers and
    // shop domains, and picking an id needs none of it.
    const result = await run(tool('list_app_connections'), { type: 'appfedex:fedex' })

    expect(result.success).toBe(true)
    const out = result.output as { app: string; connections: Array<Record<string, unknown>> }
    expect(out.app).toBe('Fedex')
    expect(out.connections.map((c) => c.connectionId)).toEqual(['cred-primary', 'cred-secondary'])
    expect(out.connections[0]).toEqual({
      connectionId: 'cred-primary',
      label: 'FedEx (workspace)',
      scope: 'organization',
      status: 'connected',
      isDefault: true,
    })
    expect(out.connections[1]).toMatchObject({ status: 'expired' })
    for (const conn of out.connections) {
      expect(conn).not.toHaveProperty('connectionVariables')
      expect(conn).not.toHaveProperty('metadata')
      expect(conn).not.toHaveProperty('userId')
    }
  })

  it('list_app_connections resolves the app by slug as well as by node type', async () => {
    const result = await run(tool('list_app_connections'), { appSlug: 'fedex' })
    expect(result.success).toBe(true)
    expect((result.output as { connections: unknown[] }).connections).toHaveLength(2)
  })

  it('list_app_connections refuses with the connect instruction when there are none', async () => {
    // The refusal has to name the METHOD an admin would connect with, not just
    // "a connection" — otherwise the instruction is a category, not a step.
    appConnections.mockResolvedValueOnce(ok([]) as never)
    const result = await run(tool('list_app_connections'), { appSlug: 'fedex' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('has no workspace connection')
    expect(result.error).toContain('FedEx account')
    expect(result.error).toContain('/app/settings/apps/installed/fedex/connections')
    // Say plainly that this is not something the agent can do, or the next turn
    // is spent trying.
    expect(result.error).toContain("I can't create it")
  })

  it('list_app_connections needs one of type or appSlug', async () => {
    const result = await run(tool('list_app_connections'), {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('appSlug')
  })

  it('list_app_connections names the fix when the app is not installed', async () => {
    const result = await run(tool('list_app_connections'), { appSlug: 'quickbooks' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('quickbooks')
    expect(result.error).toContain('list_app_blocks')
  })

  it('list_app_connections builds a count digest naming the app', () => {
    expect(
      tool('list_app_connections').buildDigest?.({ app: 'Fedex', connections: [{}, {}] })
    ).toEqual({ label: 'Fedex connections listed', resultCount: 2 })
  })

  it('list_app_blocks builds a compact count digest', () => {
    expect(tool('list_app_blocks').buildDigest?.({ blocks: [{}, {}, {}] })).toEqual({
      label: 'App blocks listed',
      resultCount: 3,
    })
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
