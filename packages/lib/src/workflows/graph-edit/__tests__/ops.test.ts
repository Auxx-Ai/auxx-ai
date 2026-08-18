// packages/lib/src/workflows/graph-edit/__tests__/ops.test.ts

/**
 * Operation-layer tests (`03-graph-edit-service.md` §9): branch wiring through
 * `manifest.connection.branches`, loop containment + the canvas's own
 * loop-delete behaviour, §4 layout stability, replaceGraph's empty-draft
 * restriction, the structural-vs-config blocking split, setTrigger's trigger
 * column re-derivation through the persist seam, and the readDraft shape.
 */

import { err as errResult } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the read the graph-edit path makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // No installed apps: these suites exercise CORE node types, so the manifest
  // lookup `loadDraftContext` builds must resolve to the registry alone.
  getCachedInstalledApps: async () => [],
}))

// The persist seam writes through WorkflowService.update (lazy-imported in
// persist.ts) — replaced so no engine/queue module graph loads and the exact
// update input (trigger columns!) can be asserted.
const serviceUpdate = vi.fn()
vi.mock('../../workflow-service', () => ({
  WorkflowService: class {
    update(...args: unknown[]) {
      return serviceUpdate(...args)
    }
  },
}))

// Partial mock — `resolveGraphOutputs` is a collaborator of the mutation
// pipeline, not the thing under test here. Stubbing the cache instead would
// not work: `normalizeConfig` reads resources too, so a rejection would land
// in the wrong place. Partial, never wholesale — a full replacement of a
// shared module dies at collection.
const resolveGraphOutputs = vi.fn()
vi.mock('../../../workflow-engine/catalog/resolve-outputs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../workflow-engine/catalog/resolve-outputs')>()
  return {
    ...actual,
    resolveGraphOutputs: (...args: unknown[]) =>
      resolveGraphOutputs.getMockImplementation()
        ? resolveGraphOutputs(...args)
        : actual.resolveGraphOutputs(...(args as Parameters<typeof actual.resolveGraphOutputs>)),
  }
})

// The blocking mail guard — checked in the pipeline so it reports as an issue.
const mailGuard = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../mail-trigger-guard', () => ({
  assertMailTriggerNotPersonal: (...args: unknown[]) => mailGuard(...args),
}))

const {
  addNode,
  applyTemplate,
  connectNodes,
  deleteNodes,
  disconnectNodes,
  replaceGraph,
  setTrigger,
  updateNode,
} = await import('../ops')
const { buildNodeSummary, readDraft } = await import('../read')

import { hashWorkflowGraph } from '../../graph-hash'
import type { DraftGraph, GraphEdge, GraphNode } from '../types'

const ORG = 'org_1'
const APP = 'wfapp_1'
const TICKET_ID = 'i5aezsg4bc6n8gof2uan3wcf'

const RESOURCES = [
  {
    id: TICKET_ID,
    type: 'custom',
    label: 'Ticket',
    plural: 'Tickets',
    apiSlug: 'tickets',
    entityType: 'ticket',
    entityDefinitionId: TICKET_ID,
    isVisible: true,
    fields: [],
  },
]

const TRIGGER_ID = 'scheduled-aaaaaaaaaaaaaaaaaaaaa'
const IFELSE_ID = 'ifelse-aaaaaaaaaaaaaaaaaaaaa'
const LOOP_ID = 'loop-aaaaaaaaaaaaaaaaaaaaa'

function triggerNode(): GraphNode {
  return {
    id: TRIGGER_ID,
    type: 'standard',
    position: { x: 100, y: 200 },
    width: 244,
    height: 100,
    data: {
      id: TRIGGER_ID,
      type: 'scheduled',
      title: 'Every Morning',
      config: {
        triggerInterval: 'days',
        timeBetweenTriggers: { days: 1, isConstant: true },
        timezone: 'UTC',
      },
      isEnabled: true,
    },
  }
}

function ifElseNode(): GraphNode {
  return {
    id: IFELSE_ID,
    type: 'standard',
    position: { x: 500, y: 200 },
    width: 244,
    height: 100,
    data: {
      id: IFELSE_ID,
      type: 'if-else',
      title: 'Check Priority',
      cases: [{ id: 'c1', case_id: 'true', logical_operator: 'and', conditions: [] }],
    },
  }
}

function loopNode(): GraphNode {
  return {
    id: LOOP_ID,
    type: 'standard',
    position: { x: 500, y: 400 },
    width: 400,
    height: 300,
    data: {
      id: LOOP_ID,
      type: 'loop',
      title: 'For each order',
      itemsSource: '',
      maxIterations: 100,
      accumulateResults: true,
    },
  }
}

function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle = 'target',
  data?: GraphEdge['data']
): GraphEdge {
  return {
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    ...(data ? { data } : {}),
  }
}

/** In-memory WorkflowApp row + db stub for `loadDraftContext`. */
function makeDb(graph: DraftGraph, triggerType: string | null = 'scheduled') {
  const app = {
    id: APP,
    name: 'My Flow',
    organizationId: ORG,
    draftWorkflow: {
      id: 'wf_draft',
      name: 'My Flow (Draft)',
      graph,
      triggerType,
      entityDefinitionId: null,
      organizationId: ORG,
      version: 3,
    },
  }
  const db = { query: { WorkflowApp: { findFirst: vi.fn(async () => app) } } }
  return db as unknown as import('@auxx/database').Database
}

/** The graph the pipeline persisted (last WorkflowService.update input). */
function persistedInput(): Record<string, unknown> {
  const call = serviceUpdate.mock.calls.at(-1)
  expect(call).toBeDefined()
  expect(call?.[0]).toBe(ORG)
  return call?.[1] as Record<string, unknown>
}

function persistedGraph(): DraftGraph {
  return persistedInput().graph as DraftGraph
}

beforeEach(() => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
  mailGuard.mockReset()
  mailGuard.mockResolvedValue(undefined)
  serviceUpdate.mockReset()
  serviceUpdate.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({
    graphHash: 'hash-after',
    triggerType: input.triggerType ?? null,
    entityDefinitionId: input.entityDefinitionId ?? null,
  }))
})

describe('addNode — branch wiring (§6)', () => {
  const base = (): DraftGraph => ({
    nodes: [triggerNode(), ifElseNode()],
    edges: [edge(TRIGGER_ID, 'source', IFELSE_ID)],
  })

  it('resolves a branch NAME to the case handle id from manifest.connection.branches', async () => {
    const result = await addNode(makeDb(base()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      title: 'Then Wait',
      after: 'Check Priority',
      branch: 'IF',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const graph = persistedGraph()
    const added = graph.nodes.find((n) => n.data?.title === 'Then Wait')
    expect(added).toBeDefined()
    const wired = graph.edges.find((e) => e.target === added?.id)
    expect(wired?.source).toBe(IFELSE_ID)
    expect(wired?.sourceHandle).toBe('true') // the case's id, never the display name
  })

  it("wires the ELSE branch on the reserved 'false' handle", async () => {
    const result = await addNode(makeDb(base()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Check Priority',
      branch: 'ELSE',
    })
    expect(result.isOk()).toBe(true)
    const graph = persistedGraph()
    const wired = graph.edges.find((e) => e.source === IFELSE_ID && e.sourceHandle === 'false')
    expect(wired).toBeDefined()
  })

  it('errors listing every branch when the anchor has several and none was named', async () => {
    const result = await addNode(makeDb(base()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Check Priority',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('branches')
    expect(serviceUpdate).not.toHaveBeenCalled()
  })
})

describe('addNode — layout stability (§4)', () => {
  it('leaves every existing node position byte-identical', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), ifElseNode()],
      edges: [edge(TRIGGER_ID, 'source', IFELSE_ID)],
    }
    const before = JSON.stringify(graph.nodes.map((n) => [n.id, n.position]))

    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Every Morning',
    })
    expect(result.isOk()).toBe(true)

    const persisted = persistedGraph()
    const after = JSON.stringify(
      persisted.nodes
        .filter((n) => n.id === TRIGGER_ID || n.id === IFELSE_ID)
        .map((n) => [n.id, n.position])
    )
    expect(after).toBe(before)

    // The anchor already feeds Check Priority, so the new node joins that
    // column below the existing sibling (branch targets stack downward).
    const added = persisted.nodes.find((n) => n.id !== TRIGGER_ID && n.id !== IFELSE_ID)
    expect(added?.position.x).toBe(500)
    expect(added?.position.y).toBe(350)
  })

  it('places a first successor one column right of its predecessor, vertically aligned', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Every Morning',
    })
    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph()
    const added = persisted.nodes.find((n) => n.id !== TRIGGER_ID)
    expect(added?.position.x).toBeGreaterThan(100 + 244)
    expect(added?.position.y).toBe(200)
  })
})

describe('loop containment (§6)', () => {
  it('addNode inside a loop sets parentId/loopId, positions in-container, wires loop-start', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), loopNode()],
      edges: [edge(TRIGGER_ID, 'source', LOOP_ID)],
    }
    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      title: 'Per Order Wait',
      inside: 'For each order',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    const child = persisted.nodes.find((n) => n.data?.title === 'Per Order Wait')
    expect(child?.parentId).toBe(LOOP_ID)
    expect(child?.extent).toBe('parent')
    expect(child?.data?.loopId).toBe(LOOP_ID)
    expect(child?.data?.isInLoop).toBe(true)
    // Parent-relative position within the container padding.
    expect(child?.position.x).toBeGreaterThanOrEqual(20)
    expect(child?.position.y).toBeGreaterThanOrEqual(80)
    // First body node: the canvas wires loop-start → first child.
    const loopStart = persisted.edges.find(
      (e) => e.source === LOOP_ID && e.sourceHandle === 'loop-start'
    )
    expect(loopStart?.target).toBe(child?.id)
    expect(result._unsafeUnwrap().node?.inside).toBe('For each order')
  })

  it('connectNodes from a loop child to its container writes the loop-back edge', async () => {
    const childId = 'wait-childaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        loopNode(),
        {
          id: childId,
          type: 'standard',
          position: { x: 78, y: 80 },
          parentId: LOOP_ID,
          data: { id: childId, type: 'wait', title: 'Per Order Wait', loopId: LOOP_ID },
        },
      ],
      edges: [edge(TRIGGER_ID, 'source', LOOP_ID), edge(LOOP_ID, 'loop-start', childId)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Per Order Wait',
      to: 'For each order',
    })
    expect(result.isOk()).toBe(true)
    const loopBack = persistedGraph().edges.find((e) => e.targetHandle === 'loop-back')
    expect(loopBack?.source).toBe(childId)
    expect(loopBack?.target).toBe(LOOP_ID)
    expect(loopBack?.data?.isLoopBackEdge).toBe(true)
  })

  it('deleting a loop deletes its children with it (canvas handleDeleteNode behaviour)', async () => {
    const childId = 'wait-childaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        loopNode(),
        {
          id: childId,
          type: 'standard',
          position: { x: 78, y: 80 },
          parentId: LOOP_ID,
          data: { id: childId, type: 'wait', title: 'Per Order Wait', loopId: LOOP_ID },
        },
      ],
      edges: [
        edge(TRIGGER_ID, 'source', LOOP_ID),
        edge(LOOP_ID, 'loop-start', childId),
        edge(childId, 'source', LOOP_ID, 'loop-back', { isLoopBackEdge: true }),
      ],
    }
    const result = await deleteNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      refs: ['For each order'],
    })
    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph()
    // Children are REMOVED with the container — never reparented — and every
    // touching edge goes with them (use-node-interactions.ts:423-446).
    expect(persisted.nodes.map((n) => n.id)).toEqual([TRIGGER_ID])
    expect(persisted.edges).toEqual([])
  })
})

describe('deleteNodes — reconnect bridging', () => {
  it('bridges surviving predecessors to surviving successors on the original handle', async () => {
    const waitId = 'wait-aaaaaaaaaaaaaaaaaaaa'
    const endId = 'end-aaaaaaaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        {
          id: waitId,
          type: 'standard',
          position: { x: 500, y: 200 },
          data: { id: waitId, type: 'wait', title: 'Cool Down' },
        },
        {
          id: endId,
          type: 'standard',
          position: { x: 900, y: 200 },
          data: { id: endId, type: 'end', title: 'Done' },
        },
      ],
      edges: [edge(TRIGGER_ID, 'source', waitId), edge(waitId, 'source', endId)],
    }
    const result = await deleteNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      refs: ['Cool Down'],
      reconnect: true,
    })
    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph()
    expect(persisted.edges).toHaveLength(1)
    expect(persisted.edges[0]).toMatchObject({
      source: TRIGGER_ID,
      sourceHandle: 'source',
      target: endId,
    })
  })
})

describe('structural vs config blocking split (§5)', () => {
  it('structural: an edge into a trigger rejects WITHOUT persisting', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), ifElseNode()],
      edges: [edge(TRIGGER_ID, 'source', IFELSE_ID)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Check Priority',
      branch: 'IF',
      to: 'Every Morning',
    })
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.applied).toBe(false)
    expect(outcome.issues.some((i) => i.severity === 'error' && /trigger/i.test(i.message))).toBe(
      true
    )
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('structural: a non-loop cycle rejects without persisting', async () => {
    const aId = 'wait-aaaaaaaaaaaaaaaaaaaa'
    const bId = 'wait-baaaaaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        {
          id: aId,
          type: 'standard',
          position: { x: 500, y: 200 },
          data: { id: aId, type: 'wait', title: 'A' },
        },
        {
          id: bId,
          type: 'standard',
          position: { x: 900, y: 200 },
          data: { id: bId, type: 'wait', title: 'B' },
        },
      ],
      edges: [edge(TRIGGER_ID, 'source', aId), edge(aId, 'source', bId)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'B',
      to: 'A',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(
      result._unsafeUnwrap().issues.some((i) => i.severity === 'error' && /cycle/i.test(i.message))
    ).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('config: a half-configured node PERSISTS and reports issues', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'answer', // fresh answer has no text — invalid config, valid draft
      after: 'Every Morning',
    })
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.applied).toBe(true)
    expect(serviceUpdate).toHaveBeenCalledTimes(1)
    expect(outcome.issues.some((i) => i.field === 'text')).toBe(true)
  })

  it('normalize: an unresolvable {{ref}} rejects without persisting', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Every Morning',
      config: { note: 'wait for {{No Such Node.value}}' },
    })
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.applied).toBe(false)
    expect(outcome.issues.some((i) => i.ref === 'No Such Node.value')).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('mail guard: a personal-channel trigger surfaces as a blocking issue, never swallowed', async () => {
    const { BadRequestError } = await import('../../../errors')
    mailGuard.mockRejectedValueOnce(
      new BadRequestError('Mail triggers cannot be configured on a personal inbox.')
    )
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Every Morning',
    })
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.applied).toBe(false)
    expect(outcome.issues.some((i) => /personal inbox/.test(i.message))).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })
})

describe('replaceGraph', () => {
  it('rejects on a NON-EMPTY draft with an actionable message', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await replaceGraph(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      nodes: [{ type: 'scheduled' }],
      edges: [],
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/incrementally/i)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('builds a branched graph on an empty draft with auto-layout and branch handles', async () => {
    const result = await replaceGraph(makeDb({ nodes: [], edges: [] }, null), {
      workflowAppId: APP,
      organizationId: ORG,
      nodes: [
        { type: 'scheduled', title: 'Daily' },
        {
          type: 'if-else',
          title: 'Route',
          config: {
            cases: [{ id: 'c1', case_id: 'true', logical_operator: 'and', conditions: [] }],
          },
        },
        { type: 'wait', title: 'On Match' },
        { type: 'wait', title: 'Otherwise' },
      ],
      edges: [
        { from: 'Daily', to: 'Route' },
        { from: 'Route', to: 'On Match', branch: 'IF' },
        { from: 'Route', to: 'Otherwise', branch: 'ELSE' },
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    expect(persisted.nodes).toHaveLength(4)
    const handles = persisted.edges
      .filter((e) => e.source === persisted.nodes[1]?.id)
      .map((e) => e.sourceHandle)
      .sort()
    expect(handles).toEqual(['false', 'true'])
    // Auto-layout: left-to-right; branch targets share a column, stacked.
    const [daily, route, onMatch, otherwise] = persisted.nodes
    expect(daily!.position.x).toBeLessThan(route!.position.x)
    expect(route!.position.x).toBeLessThan(onMatch!.position.x)
    expect(onMatch!.position.x).toBe(otherwise!.position.x)
    expect(onMatch!.position.y).not.toBe(otherwise!.position.y)
  })

  it('applyTemplate also refuses a non-empty draft', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await applyTemplate(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      userId: 'user_1',
      templateId: 'file:whatever',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/EMPTY draft/i)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })
})

describe('setTrigger — trigger columns re-derived through the persist seam (§7)', () => {
  it('retypes the trigger in place and persists derived triggerType/entityDefinitionId', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    const result = await setTrigger(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      triggerType: 'resource-trigger',
      config: { operation: 'created', resourceType: 'ticket', entityDefinitionId: 'ticket' },
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const input = persistedInput()
    // deriveTriggerColumns over the new node: operation 'created' + resolved
    // entity id → Workflow.triggerType/entityDefinitionId are RE-DERIVED, not
    // carried over from the previous 'scheduled'.
    expect(input.triggerType).toBe('created')
    expect(input.entityDefinitionId).toBe(TICKET_ID)

    // Same node id (downstream {{Every Morning.x}} refs survive the retype),
    // and the friendly resource slug was normalized to the org CUID.
    const persisted = persistedGraph()
    expect(persisted.nodes).toHaveLength(1)
    expect(persisted.nodes[0]?.id).toBe(TRIGGER_ID)
    expect(persisted.nodes[0]?.data?.type).toBe('resource-trigger')
    expect(persisted.nodes[0]?.data?.resourceType).toBe(TICKET_ID)
    expect(persisted.nodes[0]?.data?.entityDefinitionId).toBe(TICKET_ID)
  })

  it('a graph mutation that does not touch the trigger keeps the previous triggerType', async () => {
    const graph: DraftGraph = { nodes: [triggerNode()], edges: [] }
    await addNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'wait',
      after: 'Every Morning',
    })
    expect(persistedInput().triggerType).toBe('scheduled')
  })
})

describe('updateNode / disconnectNodes', () => {
  it('shallow-merges config and never lets it change id/type', async () => {
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 5, id: 'evil', type: 'code' },
    })
    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph()
    const loop = persisted.nodes.find((n) => n.id === LOOP_ID)
    expect(loop?.data?.maxIterations).toBe(5)
    expect(loop?.data?.id).toBe(LOOP_ID)
    expect(loop?.data?.type).toBe('loop')
  })

  it('a title equal to another node title stays a NAME, never a rewritten ref', async () => {
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { title: 'Every Morning', desc: 'Every Morning' },
    })
    expect(result.isOk()).toBe(true)
    const loop = persistedGraph().nodes.find((n) => n.id === LOOP_ID)
    expect(loop?.data?.title).toBe('Every Morning')
    expect(loop?.data?.desc).toBe('Every Morning')
  })

  it('deep-patches nested config atomically, preserves siblings, and durably unsets fields', async () => {
    const trigger = triggerNode()
    const graph: DraftGraph = { nodes: [trigger], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Every Morning',
      expectedConfigHash: hashWorkflowGraph(trigger.data),
      patches: [
        {
          op: 'set',
          path: ['config', 'timeBetweenTriggers', 'days'],
          value: 2,
        },
        { op: 'unset', path: ['config', 'timezone'] },
      ],
    })

    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph().nodes[0]
    expect(persisted?.data?.config).toEqual({
      triggerInterval: 'days',
      timeBetweenTriggers: { days: 2, isConstant: true },
    })
    expect(result._unsafeUnwrap().node?.configHash).not.toBe(hashWorkflowGraph(trigger.data))
  })

  it('patches an array entry without replacing its siblings', async () => {
    const conditional = ifElseNode()
    conditional.data._targetBranches = [{ id: 'true', name: 'IF', type: 'default' }]
    const graph: DraftGraph = { nodes: [triggerNode(), conditional], edges: [] }
    const configHash = buildNodeSummary(graph, conditional).configHash
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Check Priority',
      expectedConfigHash: configHash,
      patches: [{ op: 'set', path: ['cases', 0, 'logical_operator'], value: 'or' }],
    })

    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph().nodes.find((node) => node.id === IFELSE_ID)
    expect(persisted?.data?.cases).toEqual([
      { id: 'c1', case_id: 'true', logical_operator: 'or', conditions: [] },
    ])
    expect(result._unsafeUnwrap().node?.configHash).not.toBe(configHash)
  })

  it('adds a dynamic dotted key while re-normalizing the complete friendly config', async () => {
    const crudId = 'crud-aaaaaaaaaaaaaaaaaaaaa'
    const crud: GraphNode = {
      id: crudId,
      type: 'standard',
      position: { x: 500, y: 200 },
      data: {
        id: crudId,
        type: 'crud',
        title: 'Create Ticket',
        resourceType: TICKET_ID,
        mode: 'create',
        data: { subject: 'Original' },
        error_strategy: 'fail',
        default_values: [],
      },
    }
    const graph: DraftGraph = { nodes: [triggerNode(), crud], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Create Ticket',
      expectedConfigHash: hashWorkflowGraph(crud.data),
      patches: [{ op: 'set', path: ['data', 'customer.email'], value: 'person@example.com' }],
    })

    expect(result.isOk()).toBe(true)
    const persisted = persistedGraph().nodes.find((node) => node.id === crudId)
    expect(persisted?.data?.resourceType).toBe(TICKET_ID)
    expect(persisted?.data?.data).toEqual({
      subject: 'Original',
      'customer.email': 'person@example.com',
    })
  })

  it('rejects a patch based on a stale configHash, naming the CURRENT hash', async () => {
    const loop = loopNode()
    const graph: DraftGraph = { nodes: [triggerNode(), loop], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      expectedConfigHash: 'stale',
      patches: [{ op: 'set', path: ['maxIterations'], value: 5 }],
    })

    expect(result.isErr()).toBe(true)
    // The value that makes the retry succeed rides the error — a caller that
    // lost its hash used to have no way back except abandoning the mode.
    expect(result._unsafeUnwrapErr().message).toContain(hashWorkflowGraph(loop.data))
    expect(result._unsafeUnwrapErr().message).toContain('get_node')
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('applies patches WITHOUT expectedConfigHash — the CAS is optional', async () => {
    // The graph-level CAS in persistDraft already prevents a concurrent save
    // being overwritten; the node hash only narrows "my paths were chosen
    // against a stale shape". Requiring it made a lost hash unrecoverable.
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      patches: [{ op: 'set', path: ['maxIterations'], value: 5 }],
    })

    expect(result.isOk()).toBe(true)
    expect(persistedGraph().nodes.find((n) => n.id === LOOP_ID)?.data?.maxIterations).toBe(5)
  })

  it('ignores a derived-key patch, applies its siblings, and says so', async () => {
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      patches: [
        { op: 'set', path: ['_targetBranches'], value: [] },
        { op: 'set', path: ['maxIterations'], value: 7 },
      ],
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(true)
    expect(persistedGraph().nodes.find((n) => n.id === LOOP_ID)?.data?.maxIterations).toBe(7)
    expect(
      value.issues.some(
        (issue) => issue.severity === 'info' && issue.message.includes('_targetBranches')
      )
    ).toBe(true)
  })

  it("marks an untouched node's issues preExisting, and the edited node's not", async () => {
    const brokenId = 'crud-bbbbbbbbbbbbbbbbbbbbb'
    const crud: GraphNode = {
      id: brokenId,
      type: 'standard',
      position: { x: 0, y: 0 },
      data: { id: brokenId, type: 'crud', title: 'Create Ticket', mode: 'create' },
    }
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode(), crud], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 4 },
    })

    expect(result.isOk()).toBe(true)
    const issues = result._unsafeUnwrap().issues.filter((issue) => issue.nodeRef)
    // The half-configured CRUD node was already broken before this edit.
    expect(issues.some((issue) => issue.nodeRef === 'Create Ticket')).toBe(true)
    for (const issue of issues) {
      expect(issue.preExisting === true, `${issue.nodeRef}: ${issue.message}`).toBe(
        issue.nodeRef !== 'For each order'
      )
    }
  })

  it('names uncatalogued nodes ONCE on the summary, not as an issue per read', async () => {
    // Anything with no catalog manifest — an app block, or a not-yet-migrated
    // type like `webhook` — used to emit an `info` issue on every read and
    // every mutation result: un-actionable noise that buried the issues that
    // WERE actionable. It is a fact about the graph, so it rides the summary.
    //
    // `webhook` rather than an `appId:blockId` app block on purpose: a
    // colon-shaped type sends `resolveGraphOutputs` into the org cache for the
    // app-block lookup, which this suite's bare mock db cannot serve.
    const readOnlyId = 'webhook-aaaaaaaaaaaaaaaaaa'
    const readOnly: GraphNode = {
      id: readOnlyId,
      type: 'standard',
      position: { x: 900, y: 100 },
      data: { id: readOnlyId, type: 'webhook', title: 'Incoming Webhook' },
    }
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode(), readOnly], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 11 },
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.graphSummary.readOnlyNodes).toEqual(['Incoming Webhook'])
    expect(value.issues.some((i) => /not in the catalog|read-only/.test(i.message))).toBe(false)
  })

  it('still persists the edit when output resolution fails', async () => {
    // Outputs are enrichment, resolved BEFORE persistDraft. A throw there used
    // to sail past `if (resolved.isOk())` and abort an already-validated edit,
    // losing the user's change over a cache blip. Now it returns err, the
    // guard does what it was written to do, and the write lands without
    // outputs — and WITHOUT inventing unresolvable-ref issues.
    resolveGraphOutputs.mockImplementation(async () => errResult(new Error('redis down')))
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }

    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 9 },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(result._unsafeUnwrap().outputs).toBeUndefined()
    expect(serviceUpdate).toHaveBeenCalled()
    expect(persistedGraph().nodes.find((n) => n.id === LOOP_ID)?.data?.maxIterations).toBe(9)
    resolveGraphOutputs.mockReset()
  })

  it('reports a re-issued identical edit as unchanged and does NOT write', async () => {
    // The logged failure turn wrote the same config repeatedly, each time to an
    // identical hash, and nothing told it. `applied` stays true — the requested
    // state holds; `applied: false` is the blocking-issue vocabulary.
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      // loopNode() already has maxIterations: 100.
      config: { maxIterations: 100 },
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(true)
    expect(value.unchanged).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('a real edit is NOT reported unchanged', async () => {
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 42 },
    })

    expect(result._unsafeUnwrap().unchanged).toBeUndefined()
    expect(serviceUpdate).toHaveBeenCalled()
  })

  it('rejects a config-mode write of ONLY derived keys instead of silently dropping it', async () => {
    // `config` used to spread derived keys into node data and let persist strip
    // them, so the same edit was a hard error through `patches` and a silent
    // no-op through `config`. Both modes now agree.
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { _targetBranches: [] },
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('derived state')
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('honours expectedConfigHash with config mode instead of rejecting it', async () => {
    const loop = loopNode()
    const graph: DraftGraph = { nodes: [triggerNode(), loop], edges: [] }
    const stale = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 3 },
      expectedConfigHash: 'stale',
    })
    expect(stale.isErr()).toBe(true)

    const fresh = await updateNode(makeDb({ nodes: [triggerNode(), loopNode()], edges: [] }), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { maxIterations: 3 },
      expectedConfigHash: hashWorkflowGraph(loop.data),
    })
    expect(fresh.isOk()).toBe(true)
  })

  it('disconnectNodes removes the edge and errors when none exists', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), ifElseNode()],
      edges: [edge(TRIGGER_ID, 'source', IFELSE_ID)],
    }
    const removed = await disconnectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Every Morning',
      to: 'Check Priority',
    })
    expect(removed.isOk()).toBe(true)
    expect(persistedGraph().edges).toEqual([])

    const missing = await disconnectNodes(makeDb({ nodes: graph.nodes, edges: [] }), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Every Morning',
      to: 'Check Priority',
    })
    expect(missing.isErr()).toBe(true)
  })
})

describe('readDraft (§1)', () => {
  it('returns friendly summaries, per-node outputs and issues', async () => {
    const waitId = 'wait-aaaaaaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        {
          id: waitId,
          type: 'standard',
          position: { x: 500, y: 200 },
          data: {
            id: waitId,
            type: 'wait',
            title: 'Cool Down',
            note: `after {{${TRIGGER_ID}.timestamp}}`,
          },
        },
      ],
      edges: [edge(TRIGGER_ID, 'source', waitId)],
    }
    const result = await readDraft(makeDb(graph), { workflowAppId: APP, organizationId: ORG })
    expect(result.isOk()).toBe(true)
    const draft = result._unsafeUnwrap()

    expect(draft.workflowAppId).toBe(APP)
    expect(draft.name).toBe('My Flow')
    expect(draft.triggerType).toBe('scheduled')
    expect(draft.graphSummary.nodeCount).toBe(2)
    expect(draft.graphSummary.edgeCount).toBe(1)
    expect(draft.edges).toEqual([{ from: 'Every Morning', to: 'Cool Down' }])

    const wait = draft.nodes.find((n) => n.ref === 'Cool Down')
    expect(wait?.type).toBe('wait')
    // Persisted node-id refs render back as {{Title.path}} — never a raw id.
    expect(wait?.config.note).toBe('after {{Every Morning.timestamp}}')
    // Bookkeeping keys are withheld from config.
    expect(wait?.config.id).toBeUndefined()
    expect(wait?.config.title).toBeUndefined()

    // Outputs keyed by friendly ref.
    expect(Object.keys(draft.outputs)).toContain('Every Morning')
    expect(Object.keys(draft.outputs)).toContain('Cool Down')
  })
})
