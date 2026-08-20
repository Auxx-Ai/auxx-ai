// packages/lib/src/workflows/graph-edit/__tests__/branch-authoring.test.ts

/**
 * Branch authoring reliability
 * (`plans/kopilot/workflow/21-branch-authoring-reliability.md` §13.1).
 *
 * The failure this pins: an agent must commit to a branch address inside the
 * SAME tool batch that creates the branches, before any result can be read. So
 * the address has to be the `case_id` the agent itself authors (T2), the write
 * has to refuse an address that collides with the reserved ELSE handle (F1),
 * every read and write has to report the node's real branches and what is wired
 * to each (T1), an unwired branch has to be said out loud (T5), and none of it
 * may throw out of a read path when the config is degenerate (F4).
 */

import { ok as okResult } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mocks only — the cache barrel is imported by half of lib and a
// wholesale replacement dies at collection.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // Core node types only: the manifest lookup must resolve to the registry.
  getCachedInstalledApps: async () => [],
}))

// The persist seam — replaced so no engine/queue module graph loads.
const serviceUpdate = vi.fn()
vi.mock('../../workflow-service', () => ({
  WorkflowService: class {
    update(...args: unknown[]) {
      return serviceUpdate(...args)
    }
  },
}))

// Output resolution is a collaborator here, not the thing under test. An empty
// map makes `ref-check` skip its path check (nothing declared proves nothing)
// while still enforcing node existence and the upstream rule — which is what
// the `{{…}}`-in-`variableId` case needs to prove it resolved to a NODE.
const resolveGraphOutputs = vi.fn(async () => okResult(new Map()))
vi.mock('../../../workflow-engine/catalog/resolve-outputs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../workflow-engine/catalog/resolve-outputs')>()
  return { ...actual, resolveGraphOutputs: () => resolveGraphOutputs() }
})

vi.mock('../../mail-trigger-guard', () => ({
  assertMailTriggerNotPersonal: async () => {},
}))

const { addNode, connectNodes, updateNode } = await import('../ops')
const { readDraft } = await import('../read')
const { resolveConnectionSpec } = await import('../normalize/connection')
const { validateGraphStructure, validateBranchWiring } = await import('../validate')

import { getManifest } from '../../../workflow-engine/catalog/registry'
import type { DraftGraph, GraphEdge, GraphNode, Issue, NodeSummary } from '../types'

const ORG = 'org_1'
const APP = 'wfapp_1'
const TRIGGER_ID = 'scheduled-aaaaaaaaaaaaaaaaaaaaa'
const CARRIER_ID = 'wait-aaaaaaaaaaaaaaaaaaaaaaa'
const IFELSE_ID = 'ifelse-aaaaaaaaaaaaaaaaaaaaa'
const HUMAN_ID = 'human-aaaaaaaaaaaaaaaaaaaaaa'

/** The core registry alone — no app installed in these fixtures. */
const coreLookup = getManifest

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

/** A plain single-`source` node, and the upstream a condition can read. */
function carrierNode(): GraphNode {
  return {
    id: CARRIER_ID,
    type: 'standard',
    position: { x: 400, y: 200 },
    width: 244,
    height: 100,
    data: { id: CARRIER_ID, type: 'wait', title: 'Carrier' },
  }
}

function ifElseNode(cases: unknown[]): GraphNode {
  return {
    id: IFELSE_ID,
    type: 'standard',
    position: { x: 700, y: 200 },
    width: 244,
    height: 100,
    data: { id: IFELSE_ID, type: 'if-else', title: 'Check Carrier', cases },
  }
}

function humanNode(): GraphNode {
  return {
    id: HUMAN_ID,
    type: 'standard',
    position: { x: 700, y: 200 },
    width: 244,
    height: 100,
    data: {
      id: HUMAN_ID,
      type: 'human-confirmation',
      title: 'Approve Refund',
      message: 'Approve?',
      assignees: { actorIds: ['user:u1'] },
    },
  }
}

function carrierCase(caseId: string, value: string, variableId = 'Carrier.value') {
  return {
    id: `c-${caseId}`,
    case_id: caseId,
    logical_operator: 'and',
    conditions: [{ id: `cond-${caseId}`, variableId, comparison_operator: 'is', value }],
  }
}

function edge(source: string, sourceHandle: string, target: string): GraphEdge {
  return {
    id: `${source}-${sourceHandle}-${target}`,
    source,
    sourceHandle,
    target,
    targetHandle: 'target',
  }
}

function makeDb(graph: DraftGraph) {
  const app = {
    id: APP,
    name: 'My Flow',
    organizationId: ORG,
    draftWorkflow: {
      id: 'wf_draft',
      name: 'My Flow (Draft)',
      graph,
      triggerType: 'scheduled',
      entityDefinitionId: null,
      organizationId: ORG,
      version: 3,
    },
  }
  return {
    query: { WorkflowApp: { findFirst: vi.fn(async () => app) } },
  } as unknown as import('@auxx/database').Database
}

/** The graph the pipeline persisted (last WorkflowService.update input). */
function persistedGraph(): DraftGraph {
  const call = serviceUpdate.mock.calls.at(-1)
  expect(call).toBeDefined()
  return (call?.[1] as Record<string, unknown>).graph as DraftGraph
}

const scope = { workflowAppId: APP, organizationId: ORG }

beforeEach(() => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue([])
  serviceUpdate.mockReset()
  serviceUpdate.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({
    graphHash: 'hash-after',
    triggerType: input.triggerType ?? null,
    entityDefinitionId: input.entityDefinitionId ?? null,
  }))
})

/** trigger → Carrier, ready for an if-else to be added after `Carrier`. */
function baseGraph(): DraftGraph {
  return {
    nodes: [triggerNode(), carrierNode()],
    edges: [edge(TRIGGER_ID, 'source', CARRIER_ID)],
  }
}

describe('F1 — case_id is refused when it collides or repeats', () => {
  it("refuses an add_node whose case_id is the reserved 'false'", async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: { cases: [carrierCase('carrier-ups', 'ups'), carrierCase('false', 'fedex')] },
    })
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(serviceUpdate).not.toHaveBeenCalled()
    expect(value.issues.map((i) => i.message).join('\n')).toContain('reserved ELSE handle')
  })

  it('refuses duplicate case_ids', async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: { cases: [carrierCase('carrier-ups', 'ups'), carrierCase('carrier-ups', 'fedex')] },
    })
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(false)
    expect(value.issues.map((i) => i.message).join('\n')).toContain('Duplicate case_id')
  })

  it('applies meaningful, distinct case_ids', async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: {
        cases: [carrierCase('carrier-fedex', 'fedex'), carrierCase('carrier-ups', 'ups')],
      },
    })
    expect(result._unsafeUnwrap().applied).toBe(true)
  })
})

describe('T1 — branches ride every node read and write', () => {
  const twoCase = () => ({
    nodes: [
      triggerNode(),
      carrierNode(),
      ifElseNode([carrierCase('carrier-fedex', 'fedex'), carrierCase('carrier-ups', 'ups')]),
    ],
    edges: [edge(TRIGGER_ID, 'source', CARRIER_ID), edge(CARRIER_ID, 'source', IFELSE_ID)],
  })

  it('add_node returns the new node’s branches with ids, names and empty targets', async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: {
        cases: [carrierCase('carrier-fedex', 'fedex'), carrierCase('carrier-ups', 'ups')],
      },
    })
    expect(result._unsafeUnwrap().node?.branches).toEqual([
      { id: 'carrier-fedex', name: 'CASE 1', kind: 'default', connectedTo: [] },
      { id: 'carrier-ups', name: 'CASE 2', kind: 'default', connectedTo: [] },
      { id: 'false', name: 'ELSE', kind: 'default', connectedTo: [] },
    ])
  })

  it('OMITS the field entirely for a single-source node — never an empty array', async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'wait',
      title: 'Then Wait',
      after: 'Carrier',
    })
    const node = result._unsafeUnwrap().node as NodeSummary
    expect(node.branches).toBeUndefined()
    expect('branches' in node).toBe(false)
  })

  it('connect_nodes shows connectedTo grow on the branch it wired', async () => {
    const graph = twoCase()
    graph.nodes.push({
      id: 'track-aaaaaaaaaaaaaaaaaaaaaa',
      type: 'standard',
      position: { x: 1000, y: 100 },
      data: { id: 'track-aaaaaaaaaaaaaaaaaaaaaa', type: 'wait', title: 'Track FedEx' },
    })
    const result = await connectNodes(makeDb(graph), {
      ...scope,
      from: 'Check Carrier',
      to: 'Track FedEx',
      branch: 'carrier-fedex',
    })
    expect(result._unsafeUnwrap().applied).toBe(true)
    const wired = persistedGraph().edges.find((e) => e.sourceHandle === 'carrier-fedex')
    expect(wired?.target).toBe('track-aaaaaaaaaaaaaaaaaaaaaa')

    const draft = await readDraft(makeDb(persistedGraph()), scope)
    const summary = draft._unsafeUnwrap().nodes.find((n) => n.id === IFELSE_ID)
    expect(summary?.branches?.find((b) => b.id === 'carrier-fedex')?.connectedTo).toEqual([
      'Track FedEx',
    ])
  })

  it('update_node returns the RECOMPUTED branch list after a case reshape', async () => {
    const result = await updateNode(makeDb(twoCase()), {
      ...scope,
      ref: 'Check Carrier',
      config: {
        cases: [
          carrierCase('carrier-fedex', 'fedex'),
          carrierCase('carrier-ups', 'ups'),
          carrierCase('carrier-dhl', 'dhl'),
        ],
      },
    })
    const branches = result._unsafeUnwrap().node?.branches
    expect(branches?.map((b) => b.id)).toEqual([
      'carrier-fedex',
      'carrier-ups',
      'carrier-dhl',
      'false',
    ])
  })

  it('readDraft carries branches on every node summary', async () => {
    const draft = await readDraft(makeDb(twoCase()), scope)
    const nodes = draft._unsafeUnwrap().nodes
    expect(nodes.find((n) => n.id === IFELSE_ID)?.branches?.map((b) => b.id)).toEqual([
      'carrier-fedex',
      'carrier-ups',
      'false',
    ])
    expect(nodes.find((n) => n.id === CARRIER_ID)?.branches).toBeUndefined()
  })
})

describe('T2 — the address is knowable before the node exists', () => {
  it('wires a branch by case_id in the same sequence that created the node', async () => {
    // The logged failure: three calls in ONE batch, the second naming a branch
    // of a node the first has not created yet. With `case_id` as the address
    // the batch is correct as issued — nothing has to be read back.
    let graph = baseGraph()
    const created = await addNode(makeDb(graph), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: {
        cases: [carrierCase('carrier-fedex', 'fedex'), carrierCase('carrier-ups', 'ups')],
      },
    })
    expect(created._unsafeUnwrap().applied).toBe(true)
    graph = persistedGraph()

    const wired = await addNode(makeDb(graph), {
      ...scope,
      type: 'wait',
      title: 'Track FedEx',
      after: 'Check Carrier',
      branch: 'carrier-fedex', // authored above, never read back
    })
    expect(wired._unsafeUnwrap().applied).toBe(true)
    const added = persistedGraph().nodes.find((n) => n.data?.title === 'Track FedEx')
    const edgeToIt = persistedGraph().edges.find((e) => e.target === added?.id)
    expect(edgeToIt?.sourceHandle).toBe('carrier-fedex')
  })

  it('a near-miss branch ref gets a "did you mean" over both names and ids', () => {
    const nodes = [ifElseNode([carrierCase('true', 'x'), carrierCase('carrier-ups', 'ups')])]
    const byName = resolveConnectionSpec(
      nodes,
      { after: 'Check Carrier', branch: 'CASE1' },
      coreLookup
    )
    // Nearest first — "CASE 1" is one edit away, "CASE 2" two.
    expect(byName._unsafeUnwrapErr().message).toContain(
      'Did you mean "CASE 1" (true) or "CASE 2" (carrier-ups)?'
    )

    const byId = resolveConnectionSpec(
      nodes,
      { after: 'Check Carrier', branch: 'carrier-up' },
      coreLookup
    )
    expect(byId._unsafeUnwrapErr().message).toContain('Did you mean "CASE 2" (carrier-ups)?')
  })

  it('lists every candidate with BOTH name and id, and points at the id', () => {
    // The logged turn re-issued `branch: "IF"` verbatim after a flat rejection.
    // "IF" is not a near miss of "CASE 1" by any edit distance, so the
    // candidate list plus the addressing rule is what has to carry it.
    const nodes = [ifElseNode([carrierCase('true', 'x'), carrierCase('carrier-ups', 'ups')])]
    const message = resolveConnectionSpec(
      nodes,
      { after: 'Check Carrier', branch: 'IF' },
      coreLookup
    )._unsafeUnwrapErr().message
    expect(message).toContain('No branch "IF" on node "Check Carrier"')
    expect(message).toContain('Available branches: "CASE 1" (true), "CASE 2" (carrier-ups)')
    expect(message).toContain('"ELSE" (false)')
    expect(message).toContain('Address a branch by its id')
  })
})

describe('T5 — an unwired branch is reported', () => {
  it('warns per unwired non-fallback branch, and stays silent on ELSE', () => {
    const graph: DraftGraph = {
      nodes: [
        ifElseNode([carrierCase('carrier-fedex', 'fedex'), carrierCase('carrier-ups', 'ups')]),
      ],
      edges: [],
    }
    const issues = validateBranchWiring(graph, coreLookup)
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'warning'])
    expect(issues.map((i) => i.field)).toEqual(['branches', 'branches'])
    expect(issues[0]?.message).toContain('"CASE 1" (carrier-fedex)')
    expect(issues.map((i) => i.message).join()).not.toContain('ELSE')
  })

  it('stays silent on an unwired `fail` branch, for the ELSE reason', () => {
    // An unwired fail branch means "let it fail" — the legitimate default
    // behaviour of every node with no failure policy at all.
    //
    // #1766 made http's `defaultData()` write `error_strategy: 'fail'`, so from
    // that commit every newly created http node rendered a fail branch and
    // immediately warned about its own defaults. Pure noise, and it fired on
    // the most-used action node in the palette.
    const httpId = 'http-aaaaaaaaaaaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        {
          id: httpId,
          type: 'standard',
          position: { x: 100, y: 200 },
          width: 244,
          height: 100,
          data: {
            id: httpId,
            type: 'http',
            title: 'Call API',
            method: 'get',
            url: 'https://example.com',
            error_strategy: 'fail',
          },
        } as GraphNode,
      ],
      edges: [],
    }
    expect(validateBranchWiring(graph, coreLookup)).toEqual([])
  })

  it('says nothing once every branch is wired', () => {
    const graph: DraftGraph = {
      nodes: [ifElseNode([carrierCase('carrier-fedex', 'fedex')]), carrierNode()],
      edges: [edge(IFELSE_ID, 'carrier-fedex', CARRIER_ID)],
    }
    expect(validateBranchWiring(graph, coreLookup)).toEqual([])
  })

  it('errors for `human`, which has no default output to fall through to', () => {
    const issues = validateBranchWiring({ nodes: [humanNode()], edges: [] }, coreLookup)
    expect(issues).toHaveLength(3)
    expect(new Set(issues.map((i) => i.severity))).toEqual(new Set(['error']))
    expect(issues[0]?.message).toContain('dead-ends')
  })

  it('is NOT a structural error, so it never refuses a mutation', async () => {
    // Tier 2, not tier 1: a half-wired approval must stay editable.
    expect(
      validateGraphStructure({ nodes: [humanNode()], edges: [] }, { lookup: coreLookup }).filter(
        (i) => i.severity === 'error'
      )
    ).toEqual([])

    const result = await addNode(makeDb({ nodes: [humanNode()], edges: [] }), {
      ...scope,
      type: 'wait',
      title: 'Then Wait',
      after: 'Approve Refund',
      branch: 'approved',
    })
    expect(result._unsafeUnwrap().applied).toBe(true)
  })

  it('surfaces on the mutation result and in readDraft', async () => {
    const graph: DraftGraph = {
      nodes: [triggerNode(), carrierNode(), ifElseNode([carrierCase('carrier-ups', 'ups')])],
      edges: [edge(TRIGGER_ID, 'source', CARRIER_ID), edge(CARRIER_ID, 'source', IFELSE_ID)],
    }
    const draft = await readDraft(makeDb(graph), scope)
    const branchIssues = draft._unsafeUnwrap().issues.filter((i: Issue) => i.field === 'branches')
    expect(branchIssues).toHaveLength(1)
    expect(branchIssues[0]?.nodeRef).toBe('Check Carrier')
  })
})

describe('F4 — a degenerate cases config never throws out of a read path', () => {
  const emptyCases = (): DraftGraph => ({
    nodes: [triggerNode(), ifElseNode([]), carrierNode()],
    edges: [edge(TRIGGER_ID, 'source', IFELSE_ID), edge(IFELSE_ID, 'false', CARRIER_ID)],
  })

  it('validateGraphStructure does not throw and accepts the ELSE handle', () => {
    const issues = validateGraphStructure(emptyCases(), { lookup: coreLookup })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('resolveConnectionSpec does not throw', () => {
    const nodes = emptyCases().nodes
    expect(
      resolveConnectionSpec(nodes, { after: 'Check Carrier' }, coreLookup)._unsafeUnwrap()
    ).toEqual({ sourceNodeId: IFELSE_ID, sourceHandle: 'false' })
  })

  it('readDraft returns rather than 500s, and reports the config problem', async () => {
    const draft = await readDraft(makeDb(emptyCases()), scope)
    expect(draft.isOk()).toBe(true)
    const value = draft._unsafeUnwrap()
    expect(value.nodes.find((n) => n.id === IFELSE_ID)?.branches).toEqual([
      { id: 'false', name: 'ELSE', kind: 'default', connectedTo: ['Carrier'] },
    ])
    expect(value.issues.map((i) => i.message).join('\n')).toContain('At least one case is required')
  })
})

describe('F5 — a braced variableId is accepted and unwrapped', () => {
  it('strips the braces, resolves the node ref, and warns naming the field', async () => {
    const result = await addNode(makeDb(baseGraph()), {
      ...scope,
      type: 'if-else',
      title: 'Check Carrier',
      after: 'Carrier',
      config: { cases: [carrierCase('carrier-ups', 'ups', '{{Carrier.value}}')] },
    })
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(true)

    const persisted = persistedGraph().nodes.find((n) => n.data?.title === 'Check Carrier')
    const cases = persisted?.data?.cases as Array<{ conditions: Array<{ variableId: string }> }>
    // The braces are gone AND the bare path still normalized to the node id.
    expect(cases[0]?.conditions[0]?.variableId).toBe(`${CARRIER_ID}.value`)

    const warning = value.issues.find((i) => i.field?.endsWith('variableId'))
    expect(warning?.severity).toBe('warning')
    expect(warning?.field).toBe('cases.0.conditions.0.variableId')
    expect(warning?.message).toContain('BARE dotted path')

    // And crucially: no quadruple-brace ref error.
    expect(value.issues.map((i) => i.message).join('\n')).not.toContain('{{{{')
  })
})
