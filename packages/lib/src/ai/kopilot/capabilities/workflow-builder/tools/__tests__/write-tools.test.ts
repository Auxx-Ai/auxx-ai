// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/__tests__/write-tools.test.ts
//
// The write-tool contract (D12): every mutation threads the Kopilot `turnId`
// into the graph-edit scope (the snapshot lifecycle keys on it), returns the
// touched node with `{{Title.path}}`-rendered outputs and issues (coordinates
// stripped), surfaces blocked edits and CAS conflicts as actionable tool
// errors, and `run_node` says loudly that the run was simulated.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from '../../../../../../errors'
import type { GraphMutationResult } from '../../../../../../workflows/graph-edit/types'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

const assertNotSystemOwned = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../../../../../workflows/workflow-app-access-guard', () => ({
  assertWorkflowAppNotSystemOwned: (...args: unknown[]) => assertNotSystemOwned(...args),
}))

const addNodeMock = vi.fn()
const connectNodesMock = vi.fn()
vi.mock('../../../../../../workflows/graph-edit', () => ({
  addNode: (...a: unknown[]) => addNodeMock(...a),
  connectNodes: (...a: unknown[]) => connectNodesMock(...a),
}))

const runNodeMock = vi.fn()
vi.mock('../../../../../../workflows/graph-edit/run-node', () => ({
  runNode: (...a: unknown[]) => runNodeMock(...a),
}))

const requireNotDemo = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../../../../../demo', () => ({
  DemoGuard: { requireNotDemo: (...a: unknown[]) => requireNotDemo(...a) },
}))

import { createAddNodeTool } from '../add-node'
import { createConnectNodesTool } from '../connect-nodes'
import { createRunNodeTool } from '../run-node'

const ORG = 'org-1'
const WF = 'wfapp-1'
const TURN = 'turn-42'

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: WF }] }) }) }),
}

const getDeps: GetToolDeps = () =>
  ({
    db,
    sessionContext: {
      page: 'workflow.builder',
      references: [{ kind: 'workflow', id: WF }],
    },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: {
      can: () => true,
      canViewInstance: () => true,
      assertEditInstance: () => {},
    },
  }) as unknown as ToolDeps

const agentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
  turnId: TURN,
} as Parameters<AgentToolDefinition['execute']>[1]

const APPLIED: GraphMutationResult = {
  applied: true,
  node: {
    ref: 'HTTP Request',
    id: 'http-abc',
    type: 'http',
    title: 'HTTP Request',
    position: { x: 500, y: 250 },
    config: { url: 'https://example.com', method: 'POST' },
  },
  outputs: [
    { id: 'HTTP Request.response.body', label: 'Response body', type: 'object' },
    { id: 'HTTP Request.response.status', label: 'Status', type: 'number' },
  ] as never,
  issues: [{ severity: 'warning', message: 'No trigger yet' }],
  graphSummary: { nodeCount: 3, edgeCount: 2, nodes: [], edges: [], triggerType: null },
}

beforeEach(() => {
  assertNotSystemOwned.mockReset().mockResolvedValue(undefined)
  addNodeMock.mockReset().mockResolvedValue(ok(APPLIED))
  connectNodesMock.mockReset().mockResolvedValue(ok(APPLIED))
  runNodeMock
    .mockReset()
    .mockResolvedValue(
      ok({ status: 'succeeded', outputs: { body: '{}' }, error: null, elapsedTime: 0.4 })
    )
  requireNotDemo.mockClear()
})

function run(t: AgentToolDefinition, args: Record<string, unknown>): Promise<AgentToolResult> {
  return t.execute(args as never, agentDeps) as Promise<AgentToolResult>
}

describe('add_node', () => {
  it('threads the turnId + scope into graph-edit and returns {{Title.path}} outputs, no coordinates', async () => {
    const result = await run(createAddNodeTool(getDeps), {
      type: 'http',
      title: 'HTTP Request',
      description: 'Notify the order system',
      after: 'Every Morning',
      config: { url: 'https://example.com' },
    })
    expect(result.success).toBe(true)

    // The scope carries the snapshot lifecycle's turn id — non-negotiable.
    const input = addNodeMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(input).toMatchObject({
      workflowAppId: WF,
      organizationId: ORG,
      turnId: TURN,
      type: 'http',
      title: 'HTTP Request',
      after: 'Every Morning',
      config: { url: 'https://example.com', desc: 'Notify the order system' },
    })

    const output = result.output as {
      summary: string
      node: Record<string, unknown>
      outputs: Array<{ ref: string }>
      issues: unknown[]
    }
    expect(output.summary).toBe('Added HTTP Request')
    // graph-edit already rendered refs friendly — the tool wraps, never re-renders.
    expect(output.outputs.map((o) => o.ref)).toEqual([
      '{{HTTP Request.response.body}}',
      '{{HTTP Request.response.status}}',
    ])
    expect(output.node).not.toHaveProperty('position')
    expect(output.issues).toHaveLength(1)
  })

  it('digest carries the completed-action label', async () => {
    const tool = createAddNodeTool(getDeps)
    const result = await run(tool, { type: 'http' })
    const digest = tool.buildDigest?.(result.output) as { label: string; nodeCount?: number }
    expect(digest.label).toBe('Added HTTP Request')
    expect(digest.nodeCount).toBe(3)
  })

  it('a blocked edit comes back as a tool error listing the blocking issues, draft untouched', async () => {
    addNodeMock.mockResolvedValue(
      ok({
        applied: false,
        issues: [{ severity: 'error', nodeRef: 'HTTP Request', message: 'url is not valid' }],
        graphSummary: { nodeCount: 2, edgeCount: 1, nodes: [], edges: [], triggerType: null },
      } satisfies GraphMutationResult)
    )
    const result = await run(createAddNodeTool(getDeps), { type: 'http' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/NOT applied/)
    expect(result.error).toContain('url is not valid')
    expect((result.output as { applied: boolean }).applied).toBe(false)
  })

  it('a CAS conflict surfaces graph-edit’s actionable retry message', async () => {
    addNodeMock.mockResolvedValue(
      err(new ConflictError('The workflow draft changed — re-read the draft and retry.'))
    )
    const result = await run(createAddNodeTool(getDeps), { type: 'http' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/re-read/i)
  })
})

describe('connect_nodes', () => {
  it('summarizes as "Connected A → B [branch]"', async () => {
    const result = await run(createConnectNodesTool(getDeps), {
      from: 'Find Contact',
      to: 'Send Email',
      branch: 'Found',
    })
    expect(result.success).toBe(true)
    expect((result.output as { summary: string }).summary).toBe(
      'Connected Find Contact → Send Email [Found]'
    )
    expect(connectNodesMock.mock.calls[0]?.[1]).toMatchObject({
      from: 'Find Contact',
      to: 'Send Email',
      branch: 'Found',
      turnId: TURN,
    })
  })
})

describe('run_node', () => {
  it('is approval-gated, demo-blocked, and SAYS the run is simulated', async () => {
    const tool = createRunNodeTool(getDeps)
    expect(tool.requiresApproval).toBe(true)

    const result = await run(tool, { ref: 'Send Email', input: { 'Find Contact.email': 'a@b.co' } })
    expect(requireNotDemo).toHaveBeenCalledWith(ORG, 'run workflow nodes', false)
    expect(result.success).toBe(true)
    const output = result.output as { simulated: boolean; note: string; status: string }
    expect(output.simulated).toBe(true)
    expect(output.note).toMatch(/SIMULATED/i)
    expect(output.status).toBe('succeeded')

    expect(runNodeMock.mock.calls[0]?.[1]).toMatchObject({
      workflowAppId: WF,
      organizationId: ORG,
      nodeId: 'Send Email',
      userId: 'member-1',
      input: { 'Find Contact.email': 'a@b.co' },
    })
  })
})
