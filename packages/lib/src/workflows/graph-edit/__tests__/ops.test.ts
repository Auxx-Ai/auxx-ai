// packages/lib/src/workflows/graph-edit/__tests__/ops.test.ts

/**
 * Operation-layer tests (`03-graph-edit-service.md` §9): branch wiring through
 * `manifest.connection.branches`, loop containment + the canvas's own
 * loop-delete behaviour, §4 layout stability, replaceGraph's empty-draft
 * restriction, the structural-vs-config blocking split, setTrigger's trigger
 * column re-derivation through the persist seam, and the readDraft shape.
 */

import { err as errResult, ok as okResult } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the read the graph-edit path makes is stubbed.
const getCachedResources = vi.fn()
const getCachedInstalledApps = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // Controllable per test: most cases exercise CORE node types and want the
  // manifest lookup to resolve to the registry alone; the app-block suite
  // below installs one.
  getCachedInstalledApps: (...args: unknown[]) => getCachedInstalledApps(...args),
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

// The credential store — `checkConnectionBinding` reads one row by id. Mocked
// so the binding rules can be exercised without a database; `getCredential` is
// already org-scoped and secret-free, so nothing here weakens what it proves.
const getCredential = vi.fn(async (..._a: unknown[]) => okResult({}))
vi.mock('@auxx/credentials/store', () => ({
  getCredential: (...a: unknown[]) => getCredential(...a),
}))

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

import { type GraphDocument, hydrateGraph } from '../../../workflow-engine/catalog/graph-hydration'
import { HYDRATION_OPTIONS } from '../../../workflow-engine/catalog/hydration-policy'
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

/**
 * What the NEXT load of a persisted graph looks like — the stored document put
 * back through the read boundary (`loadDraftContext` → `hydrateGraph`).
 *
 * The write seam stores authored content only, so every derived key
 * (`extent`, `data.id`, `data.isInLoop`/`loopId`, `edge.data.isLoopBackEdge`,
 * the handle defaults) is asserted HERE rather than on the stored bytes.
 */
function reread(graph: DraftGraph): DraftGraph {
  return hydrateGraph(graph as unknown as GraphDocument, HYDRATION_OPTIONS) as unknown as DraftGraph
}

beforeEach(() => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue(RESOURCES)
  getCachedInstalledApps.mockReset()
  getCachedInstalledApps.mockResolvedValue([])
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
    // `parentId` is the AUTHORED containment and is what persists; `extent`,
    // `loopId` and `isInLoop` are derived FROM it and are rebuilt at the read
    // boundary rather than stored (plan 23 §1.1).
    expect(child?.parentId).toBe(LOOP_ID)
    expect(child).not.toHaveProperty('extent')
    expect(child?.data).not.toHaveProperty('loopId')
    expect(child?.data).not.toHaveProperty('isInLoop')
    const loadedChild = reread(persisted).nodes.find((n) => n.data?.title === 'Per Order Wait')
    expect(loadedChild?.extent).toBe('parent')
    expect(loadedChild?.data?.loopId).toBe(LOOP_ID)
    expect(loadedChild?.data?.isInLoop).toBe(true)
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
    const persisted = persistedGraph()
    const loopBack = persisted.edges.find((e) => e.targetHandle === 'loop-back')
    expect(loopBack?.source).toBe(childId)
    expect(loopBack?.target).toBe(LOOP_ID)
    // `isLoopBackEdge` is derived from the handle (and from containment), so it
    // is rebuilt on read rather than stored — see plan 23 §1.1.
    expect(loopBack?.data).toBeUndefined()
    const reloaded = reread(persisted).edges.find((e) => e.targetHandle === 'loop-back')
    expect(reloaded?.data?.isLoopBackEdge).toBe(true)
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
    // `data.id` duplicates `node.id`, so it is derived rather than stored — and
    // it comes back on read (plan 23 §1.1).
    expect(loop?.data).not.toHaveProperty('id')
    expect(reread(persisted).nodes.find((n) => n.id === LOOP_ID)?.data?.id).toBe(LOOP_ID)
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
    // Anything with no catalog manifest — an app block whose app was
    // uninstalled, or a retired core type still sitting on an old graph — used
    // to emit an `info` issue on every read and every mutation result:
    // un-actionable noise that buried the issues that WERE actionable. It is a
    // fact about the graph, so it rides the summary.
    //
    // `number-input` (retired during the catalog burn-down, and still
    // persistable on a legacy graph) rather than an `appId:blockId` app block
    // on purpose: a colon-shaped type sends `resolveGraphOutputs` into the org
    // cache for the app-block lookup, which this suite's bare mock db cannot
    // serve.
    const readOnlyId = 'legacy-aaaaaaaaaaaaaaaaaa'
    const readOnly: GraphNode = {
      id: readOnlyId,
      type: 'standard',
      position: { x: 900, y: 100 },
      data: { id: readOnlyId, type: 'number-input', title: 'Incoming Webhook' },
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

// ---------------------------------------------------------------------------
// App blocks, end to end (plan 17 PR B3)
//
// The checkpoint the plan describes: Kopilot can add and edit a node
// contributed by an installed app. Everything below goes through the real
// mutation pipeline — `loadDraftContext` builds the manifest lookup off the
// stubbed org cache, exactly as it does in production.
// ---------------------------------------------------------------------------

const ACME_APP_ID = 'acme00000000000000000000'
const ACME_TYPE = `${ACME_APP_ID}:sync`
const ACME_NODE_ID = 'acme-sync-aaaaaaaaaaaaaaa'
const APP_WAIT_ID = 'wait-aaaaaaaaaaaaaaaaaaaaa'

function plainNode(id: string, type: string, title: string, data: Record<string, unknown>) {
  return {
    id,
    type: 'standard',
    position: { x: 100, y: 200 },
    width: 244,
    height: 100,
    data: { id, type, title, ...data },
  } as GraphNode
}

function installAcme() {
  getCachedInstalledApps.mockResolvedValue([
    {
      installationId: 'inst_1',
      installationType: 'production',
      installedAt: '2026-08-01T00:00:00.000Z',
      app: {
        id: ACME_APP_ID,
        slug: 'acme',
        title: 'Acme',
        description: null,
        avatarUrl: null,
        category: null,
      },
      currentDeployment: null,
      methods: [],
      connectionDefinitions: {},
      orgConnectionPresent: true,
      orgConnectionExpiresAt: null,
      workflowBlocks: [
        {
          id: 'sync',
          label: 'Acme Sync',
          description: 'Sync a record with Acme',
          iconKey: null,
          inputsJsonSchema: {
            recordId: { type: 'string', _metadata: { label: 'Record' } },
          },
          toolMap: { 'record.sync': 'tool_sync', 'record.archive': 'tool_archive' },
          refs: [],
          ops: [
            {
              key: 'record.sync',
              resource: 'record',
              operation: 'sync',
              toolId: 'tool_sync',
              inputsJsonSchema: {},
              outputsJsonSchema: {},
              requiresConnection: false,
            },
            {
              key: 'record.archive',
              resource: 'record',
              operation: 'archive',
              toolId: 'tool_archive',
              inputsJsonSchema: {},
              outputsJsonSchema: {},
              requiresConnection: false,
            },
          ],
        },
      ],
    },
  ])
}

const waitOnlyGraph = (): DraftGraph => ({
  nodes: [
    plainNode(APP_WAIT_ID, 'wait', 'Wait A Bit', { waitType: 'duration', durationAmount: 5 }),
  ],
  edges: [],
})

describe('app blocks — connection binding (§7 D2)', () => {
  const CRED = 'i9pksgc3uj8dqpkjneq1uheb'

  function acmeGraph(): DraftGraph {
    return {
      nodes: [
        plainNode(ACME_NODE_ID, ACME_TYPE, 'Acme Sync', {
          appId: ACME_APP_ID,
          blockId: 'sync',
          resource: 'record',
          operation: 'archive',
        }),
      ],
      edges: [],
    }
  }

  function bind(connectionId: string) {
    installAcme()
    return updateNode(makeDb(acmeGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      config: { connectionId },
    })
  }

  beforeEach(() => getCredential.mockReset())

  it('binds a workspace connection belonging to the same app', async () => {
    getCredential.mockResolvedValue(
      okResult({ id: CRED, appId: ACME_APP_ID, userId: null, organizationId: ORG }) as never
    )
    const result = await bind(CRED)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(persistedGraph().nodes.find((n) => n.id === ACME_NODE_ID)?.data?.connectionId).toBe(CRED)
  })

  it('refuses an id that does not exist in this workspace', async () => {
    // Org-scoped `getCredential` returns not-found for a FOREIGN row too, so a
    // probe cannot use this to confirm another org's credential exists.
    getCredential.mockResolvedValue(errResult(new Error('CREDENTIAL_NOT_FOUND')) as never)
    const result = await bind(CRED)

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(serviceUpdate).not.toHaveBeenCalled()
    const issue = value.issues.find((i) => i.field === 'connectionId')
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toContain('does not exist in this workspace')
    expect(issue?.message).toContain('list_app_connections')
  })

  it("refuses another app's connection", async () => {
    // The check the RUNTIME does not do: `resolveConnectionForRuntime` resolves
    // whatever row the id names and hands it to this block's lambda.
    getCredential.mockResolvedValue(
      okResult({ id: CRED, appId: 'otherapp0000000000000000', userId: null }) as never
    )
    const result = await bind(CRED)

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    // That app is not installed here, so there is no title to name — the
    // sentence has to work without one rather than reading "is a another app".
    expect(value.issues.find((i) => i.field === 'connectionId')?.message).toContain(
      'belongs to a different app — this node is a Acme block'
    )
  })

  it('names the other app when that one IS installed too', async () => {
    installAcme()
    const apps = await getCachedInstalledApps()
    getCachedInstalledApps.mockResolvedValue([
      ...(apps as unknown[]),
      {
        installationId: 'inst_2',
        app: { id: 'zenith00000000000000000z', slug: 'zenith', title: 'Zenith' },
        methods: [],
        connectionDefinitions: {},
        orgConnectionPresent: true,
        orgConnectionExpiresAt: null,
        workflowBlocks: [],
      },
    ] as never)
    getCredential.mockResolvedValue(
      okResult({ id: CRED, appId: 'zenith00000000000000000z', userId: null }) as never
    )
    const result = await updateNode(makeDb(acmeGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      config: { connectionId: CRED },
    })

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(value.issues.find((i) => i.field === 'connectionId')?.message).toContain(
      'is a Zenith connection — this node is a Acme block'
    )
  })

  it('refuses a PERSONAL connection, and says why', async () => {
    // A personal credId on a shared graph pins the workflow to one person, and
    // a scheduled run then resolves nothing.
    getCredential.mockResolvedValue(
      okResult({ id: CRED, appId: ACME_APP_ID, userId: 'user-1' }) as never
    )
    const result = await bind(CRED)

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    const message = value.issues.find((i) => i.field === 'connectionId')?.message ?? ''
    expect(message).toContain('personal connection')
    expect(message).toContain('or a schedule')
  })

  it('reads no credential at all when connectionId is unset', async () => {
    // Unbound is the healthy, normal state — the runtime resolves the workspace
    // default. It must not cost a lookup, and must never be an issue.
    installAcme()
    const result = await updateNode(makeDb(acmeGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      config: { operation: 'sync' },
    })

    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(getCredential).not.toHaveBeenCalled()
  })

  it('reads no credential for a CORE node type carrying a connectionId-ish key', async () => {
    const graph: DraftGraph = { nodes: [triggerNode(), loopNode()], edges: [] }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'For each order',
      config: { connectionId: CRED },
    })

    expect(result.isOk()).toBe(true)
    expect(getCredential).not.toHaveBeenCalled()
  })
})

describe('reference gate — O1 (plan 17 §0)', () => {
  const HTTP_ID = 'http-aaaaaaaaaaaaaaaaaaaaa'

  /** The trigger declares exactly one output, so `.bogus` is provably wrong. */
  function stubTriggerOutputs() {
    resolveGraphOutputs.mockImplementation(async () =>
      okResult(
        new Map([
          [TRIGGER_ID, [{ id: `${TRIGGER_ID}.timestamp`, label: 'Timestamp', type: 'string' }]],
        ])
      )
    )
  }

  function httpNode(url: string): GraphNode {
    return {
      id: HTTP_ID,
      type: 'standard',
      position: { x: 500, y: 200 },
      data: { id: HTTP_ID, type: 'http', title: 'Post To Webhook', method: 'GET', url },
    }
  }

  beforeEach(stubTriggerOutputs)
  afterEach(() => resolveGraphOutputs.mockReset())

  it('refuses an edit that writes a reference the outputs do not have', async () => {
    // The S2 asymmetry, applied to tier 3: a ref this call wrote — against
    // outputs it could see — is a defect nothing downstream contradicts.
    const graph: DraftGraph = {
      nodes: [triggerNode(), httpNode('https://example.com')],
      edges: [edge(TRIGGER_ID, 'source', HTTP_ID)],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Post To Webhook',
      config: { url: 'https://example.com/{{Every Morning.bogus}}' },
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(serviceUpdate).not.toHaveBeenCalled()
    const blocking = value.issues.filter((i) => i.severity === 'error' && !i.preExisting)
    expect(blocking.some((i) => /bogus/.test(i.message))).toBe(true)
    // The refusal names its own cause — severity alone cannot, see the
    // co-reported-connection-error case below.
    expect(value.blockedBy).toBeDefined()
    expect(value.blockedBy).toHaveLength(1)
    expect(value.blockedBy?.[0]?.message).toMatch(/bogus/)
  })

  it('blockedBy names ONLY the ref error, not a co-reported connection error', async () => {
    // The 2026-08-18 misdiagnosis. An app block whose app has no workspace
    // connection reports `severity: 'error'` — the block cannot RUN — but that
    // never blocks AUTHORING, and the O1 gate does not consider it. A renderer
    // keying off severity therefore prints it under "blocking issues", and the
    // caller (correctly, given what it was told) reports the workflow as
    // blocked on connections when a bad reference was the only reason.
    getCachedInstalledApps.mockResolvedValue([
      {
        installationId: 'inst_1',
        installationType: 'production',
        installedAt: '2026-08-01T00:00:00.000Z',
        app: {
          id: ACME_APP_ID,
          slug: 'acme',
          title: 'Acme',
          description: null,
          avatarUrl: null,
          category: null,
        },
        currentDeployment: null,
        methods: [],
        connectionDefinitions: {},
        // The two facts that make the connection issue an ERROR.
        orgConnectionPresent: false,
        orgConnectionExpiresAt: null,
        workflowBlocks: [
          {
            id: 'sync',
            label: 'Acme Sync',
            description: 'Sync a record with Acme',
            iconKey: null,
            requiresConnection: true,
            inputsJsonSchema: {
              recordId: { type: 'string', _metadata: { label: 'Record' } },
            },
            toolMap: { 'record.sync': 'tool_sync' },
            refs: [],
            ops: [
              {
                key: 'record.sync',
                resource: 'record',
                operation: 'sync',
                toolId: 'tool_sync',
                inputsJsonSchema: {},
                outputsJsonSchema: {},
                requiresConnection: true,
              },
            ],
          },
        ],
      },
    ] as never)

    const graph: DraftGraph = {
      nodes: [
        triggerNode(),
        plainNode(ACME_NODE_ID, ACME_TYPE, 'Acme Sync', {
          appId: ACME_APP_ID,
          blockId: 'sync',
          resource: 'record',
          operation: 'sync',
        }),
      ],
      edges: [edge(TRIGGER_ID, 'source', ACME_NODE_ID)],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      // `fieldModes` flips recordId out of constant mode, so the ref is a REF
      // and reaches the O1 gate rather than being stored as literal text.
      config: {
        resource: 'record',
        operation: 'sync',
        recordId: '{{Every Morning.bogus}}',
        fieldModes: { recordId: false },
      },
    })

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)

    // BOTH are reported — the connection problem is real and the caller should
    // hear about it.
    const connectionIssue = value.issues.find((i) => i.field === 'connectionId')
    expect(connectionIssue?.severity).toBe('error')
    expect(connectionIssue?.message).toMatch(/no workspace connection/)

    // But only ONE of them refused the edit.
    expect(value.blockedBy).toHaveLength(1)
    expect(value.blockedBy?.[0]?.message).toMatch(/bogus/)
    expect(value.blockedBy).not.toContain(connectionIssue)
  })

  it('applies the same edit when the reference resolves', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), httpNode('https://example.com')],
      edges: [edge(TRIGGER_ID, 'source', HTTP_ID)],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Post To Webhook',
      config: { url: 'https://example.com/{{Every Morning.timestamp}}' },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(serviceUpdate).toHaveBeenCalled()
  })

  it('still edits a node that ALREADY carried a broken reference', async () => {
    // The #1649 trap: the `preExisting` stamp is per NODE, so an old bad ref on
    // the very node being edited looks fresh. Gating on that alone would make
    // the node uneditable — the gate subtracts the draft's before-state instead.
    const graph: DraftGraph = {
      nodes: [triggerNode(), httpNode(`https://example.com/{{${TRIGGER_ID}.bogus}}`)],
      edges: [edge(TRIGGER_ID, 'source', HTTP_ID)],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Post To Webhook',
      config: { method: 'POST' },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(persistedGraph().nodes.find((n) => n.id === HTTP_ID)?.data?.method).toBe('POST')
    // Reported, never silent — tier 3 is still a report for what it inherited.
    expect(
      result._unsafeUnwrap().issues.some((i) => i.severity === 'error' && /bogus/.test(i.message))
    ).toBe(true)
  })

  it('does not block a delete that strands a downstream reference', async () => {
    // Removing a producer is an intentional, user-requested act, and
    // `deleteNodes` names no touched node — so the stranded refs it leaves
    // behind are reported, not refused.
    const graph: DraftGraph = {
      nodes: [triggerNode(), httpNode(`https://example.com/{{${TRIGGER_ID}.timestamp}}`)],
      edges: [edge(TRIGGER_ID, 'source', HTTP_ID)],
    }
    const result = await deleteNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      refs: ['Every Morning'],
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(serviceUpdate).toHaveBeenCalled()
  })

  it('fails OPEN when the before-state cannot be resolved', async () => {
    // No "before" to compare against ⇒ nothing is provably fresh. Refusing a
    // write on an unknown is worse than flagging one.
    let call = 0
    resolveGraphOutputs.mockImplementation(async () => {
      call += 1
      // First call is the post-edit graph; the second is the before-pass.
      return call === 1
        ? okResult(
            new Map([
              [TRIGGER_ID, [{ id: `${TRIGGER_ID}.timestamp`, label: 'Timestamp', type: 'string' }]],
            ])
          )
        : errResult(new Error('redis down'))
    })
    const graph: DraftGraph = {
      nodes: [triggerNode(), httpNode('https://example.com')],
      edges: [edge(TRIGGER_ID, 'source', HTTP_ID)],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Post To Webhook',
      config: { url: 'https://example.com/{{Every Morning.bogus}}' },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
  })
})

describe('app blocks — authoring (§5 B3 checkpoint)', () => {
  it('adds a node contributed by an installed app', async () => {
    installAcme()
    const result = await addNode(makeDb(waitOnlyGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: ACME_TYPE,
      after: 'Wait A Bit',
      config: { resource: 'record', operation: 'archive' },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const added = persistedGraph().nodes.find((n) => n.data?.type === ACME_TYPE)
    expect(added?.data).toMatchObject({
      type: ACME_TYPE,
      appId: ACME_APP_ID,
      appSlug: 'acme',
      blockId: 'sync',
      title: 'Acme Sync',
      resource: 'record',
      operation: 'archive',
    })
    // A plain downstream edge on the default source handle — app blocks
    // declare no branches.
    expect(persistedGraph().edges).toContainEqual(
      expect.objectContaining({ source: APP_WAIT_ID, sourceHandle: 'source', target: added?.id })
    )
  })

  it('refuses a node whose operation the block does not offer', async () => {
    // S2: a FABRICATED operation must fail the write, or the agent believes it
    // succeeded and nothing downstream says otherwise.
    installAcme()
    const result = await addNode(makeDb(waitOnlyGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: ACME_TYPE,
      after: 'Wait A Bit',
      config: { resource: 'record', operation: 'teleport' },
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(value.issues.some((i) => i.severity === 'error' && i.field === 'operation')).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('edits an existing app-block node — the hard 400 is gone', async () => {
    // `updateNode` checks the EXISTING node's type through
    // `requireAuthorableManifest`, which used to reject every app block
    // outright. This is the §1 log's blocked path.
    installAcme()
    const graph: DraftGraph = {
      nodes: [
        plainNode(APP_WAIT_ID, 'wait', 'Wait A Bit', { waitType: 'duration', durationAmount: 5 }),
        plainNode(ACME_NODE_ID, ACME_TYPE, 'Acme Sync', {
          appId: ACME_APP_ID,
          blockId: 'sync',
          resource: 'record',
          operation: 'sync',
        }),
      ],
      edges: [],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      config: { resource: 'record', operation: 'archive' },
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(persistedGraph().nodes.find((n) => n.id === ACME_NODE_ID)?.data?.operation).toBe(
      'archive'
    )
  })

  it('withholds app identity from the node summary, and the patch path keeps it', async () => {
    // C3 hygiene: `appId`/`appSlug`/`blockId` are stamped identity, not config —
    // `appId` and `blockId` are already the two halves of `type`. Withholding
    // them also makes them DURABLE: the `patches` path deletes every key the
    // summary showed before re-applying, so a key the summary never showed
    // survives the write untouched.
    installAcme()
    const graph: DraftGraph = {
      nodes: [
        plainNode(ACME_NODE_ID, ACME_TYPE, 'Acme Sync', {
          appId: ACME_APP_ID,
          appSlug: 'acme',
          blockId: 'sync',
          resource: 'record',
          operation: 'sync',
        }),
      ],
      edges: [],
    }
    const result = await updateNode(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      ref: 'Acme Sync',
      patches: [{ op: 'set', path: ['operation'], value: 'archive' }],
    })

    expect(result.isOk()).toBe(true)
    const summary = result._unsafeUnwrap().node
    expect(summary?.config).not.toHaveProperty('appId')
    expect(summary?.config).not.toHaveProperty('appSlug')
    expect(summary?.config).not.toHaveProperty('blockId')
    expect(summary?.config).toMatchObject({ resource: 'record', operation: 'archive' })

    // Still on the node, so the processor can still dispatch it.
    expect(persistedGraph().nodes.find((n) => n.id === ACME_NODE_ID)?.data).toMatchObject({
      appId: ACME_APP_ID,
      appSlug: 'acme',
      blockId: 'sync',
      operation: 'archive',
    })
  })

  it('names the app-block shape when the type resolves to nothing', async () => {
    // Listing the ~27 core ids at someone who typed a colon answers a question
    // they did not ask.
    const result = await addNode(makeDb(waitOnlyGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'notinstalled0000000000000:sync',
      after: 'Wait A Bit',
    })

    expect(result.isErr()).toBe(true)
    const message = result._unsafeUnwrapErr().message
    expect(message).toContain('<appId>:<blockId>')
    expect(message).toContain('not installed')
    expect(message).not.toContain('wait, ')
  })

  it('still lists the core types for a plain unknown type', async () => {
    const result = await addNode(makeDb(waitOnlyGraph()), {
      workflowAppId: APP,
      organizationId: ORG,
      type: 'nonsense',
      after: 'Wait A Bit',
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Core node types:')
  })
})
