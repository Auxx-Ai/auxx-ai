// packages/lib/src/workflows/graph-edit/__tests__/input-wiring.test.ts

/**
 * Input wiring (`plans/kopilot/workflow/15-form-input-migration.md` §2/§4a/§5):
 * a `form-input` node attaches to a `manual` trigger with a BACKWARDS edge on
 * two non-standard handles (`input-output` → `input`). Three structural rules
 * used to reject that shape outright, which made every workflow containing a
 * form-input node — and `apply_template('manual-ticket-triage')` — un-editable.
 *
 * These tests pin BOTH directions: the wiring validates and round-trips, and
 * the rules it excepts still fire for everything else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mock — the cache barrel is imported by half of lib; replacing it
// wholesale dies at collection. Only the read the graph-edit path makes is stubbed.
const getCachedResources = vi.fn()
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
}))

// The persist seam writes through WorkflowService.update (lazy-imported in
// persist.ts) — replaced so no engine/queue module graph loads and the exact
// persisted graph can be asserted.
const serviceUpdate = vi.fn()
vi.mock('../../workflow-service', () => ({
  WorkflowService: class {
    update(...args: unknown[]) {
      return serviceUpdate(...args)
    }
  },
}))

const mailGuard = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../mail-trigger-guard', () => ({
  assertMailTriggerNotPersonal: (...args: unknown[]) => mailGuard(...args),
}))

const { applyTemplate, connectNodes, deleteNodes, disconnectNodes } = await import('../ops')

import { manualManifest } from '../../../workflow-engine/catalog/nodes/manual'
import { staticOutputContext } from '../../../workflow-engine/catalog/output-context'
// The SHIPPED template, loaded rather than re-typed, so this test cannot drift
// away from the graph shape that actually exists in the repo.
import manualTicketTriage from '../../templates/manual-ticket-triage.template.json'
import type { DraftGraph, GraphEdge, GraphNode } from '../types'
import { validateGraphStructure } from '../validate'

const ORG = 'org_1'
const APP = 'wfapp_1'

const TEMPLATE_GRAPH = manualTicketTriage.graph as unknown as DraftGraph

const MANUAL_ID = 'manual-aaaaaaaaaaaaaaaaaaaa'
const FORM_ID = 'form-input-aaaaaaaaaaaaaaa'
const WAIT_ID = 'wait-aaaaaaaaaaaaaaaaaaaaa'
const SECOND_FORM_ID = 'form-input-bbbbbbbbbbbbbbb'

function manualNode(inputNodes: string[] = []): GraphNode {
  return {
    id: MANUAL_ID,
    type: 'standard',
    position: { x: 100, y: 300 },
    width: 244,
    height: 100,
    data: { id: MANUAL_ID, type: 'manual', title: 'Manual Trigger', inputNodes },
  }
}

/** A form-input node — `NodeCategory.INPUT` in the catalog since PR 2. */
function formInputNode(): GraphNode {
  return {
    id: FORM_ID,
    type: 'standard',
    position: { x: -200, y: 225 },
    width: 244,
    height: 100,
    data: {
      id: FORM_ID,
      type: 'form-input',
      title: 'Ticket Subject',
      label: 'Subject',
      inputType: 'string',
    },
  }
}

/** A second form-input, so a graph can carry two distinct input fields. */
function secondFormInputNode(): GraphNode {
  return {
    id: SECOND_FORM_ID,
    type: 'standard',
    position: { x: -200, y: 325 },
    width: 244,
    height: 100,
    data: {
      id: SECOND_FORM_ID,
      type: 'form-input',
      title: 'Ticket Body',
      label: 'Body',
      inputType: 'string',
    },
  }
}

function waitNode(): GraphNode {
  return {
    id: WAIT_ID,
    type: 'standard',
    position: { x: 500, y: 300 },
    width: 244,
    height: 100,
    data: { id: WAIT_ID, type: 'wait', title: 'Cool Down' },
  }
}

function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle = 'target'
): GraphEdge {
  return {
    id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function inputEdge(source: string, target: string): GraphEdge {
  return edge(source, 'input-output', target, 'input')
}

/** In-memory WorkflowApp row + db stub for `loadDraftContext`. */
function makeDb(graph: DraftGraph, triggerType: string | null = 'manual') {
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

function persistedGraph(): DraftGraph {
  const call = serviceUpdate.mock.calls.at(-1)
  expect(call).toBeDefined()
  return (call?.[1] as Record<string, unknown>).graph as DraftGraph
}

function errors(issues: ReturnType<typeof validateGraphStructure>) {
  return issues.filter((i) => i.severity === 'error')
}

beforeEach(() => {
  getCachedResources.mockReset()
  getCachedResources.mockResolvedValue([])
  mailGuard.mockReset()
  mailGuard.mockResolvedValue(undefined)
  serviceUpdate.mockReset()
  serviceUpdate.mockImplementation(async (_org: string, input: Record<string, unknown>) => ({
    graphHash: 'hash-after',
    triggerType: input.triggerType ?? null,
    entityDefinitionId: input.entityDefinitionId ?? null,
  }))
})

describe('validateGraphStructure — input wiring (§2)', () => {
  it('the shipped manual-ticket-triage graph produces ZERO blocking issues', () => {
    const issues = validateGraphStructure(TEMPLATE_GRAPH)
    expect(errors(issues)).toEqual([])
  })

  it('accepts form-input → manual on the input handles', () => {
    const graph: DraftGraph = {
      nodes: [formInputNode(), manualNode(), waitNode()],
      edges: [inputEdge(FORM_ID, MANUAL_ID), edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    expect(errors(validateGraphStructure(graph))).toEqual([])
  })

  it('an input-handle edge into a node that does NOT accept inputs is still an error', () => {
    const graph: DraftGraph = {
      nodes: [manualNode(), formInputNode(), waitNode()],
      edges: [edge(MANUAL_ID, 'source', WAIT_ID), inputEdge(FORM_ID, WAIT_ID)],
    }
    const blocking = errors(validateGraphStructure(graph))
    expect(blocking.some((i) => /unknown handle "input"/.test(i.message))).toBe(true)
  })

  it('a plain source → target edge into a trigger is still an error', () => {
    const graph: DraftGraph = {
      nodes: [manualNode(), waitNode()],
      edges: [edge(WAIT_ID, 'source', MANUAL_ID)],
    }
    const blocking = errors(validateGraphStructure(graph))
    expect(blocking.some((i) => /incoming connections/.test(i.message))).toBe(true)
  })

  it('a form-input edge onto a trigger on the DEFAULT handles is still an error', () => {
    const graph: DraftGraph = {
      nodes: [formInputNode(), manualNode()],
      edges: [edge(FORM_ID, 'source', MANUAL_ID)],
    }
    const blocking = errors(validateGraphStructure(graph))
    expect(blocking.some((i) => /incoming connections/.test(i.message))).toBe(true)
  })

  /**
   * The READ side is strict on the source too, so the exception cannot be
   * borrowed by a type that merely lacks a manifest. App-block types lack one
   * permanently, which is why this is not a transitional case.
   */
  it('an uncatalogued app-block on the input handles is NOT accepted as input wiring', () => {
    const APP_BLOCK_ID = 'app-block-aaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        {
          id: APP_BLOCK_ID,
          type: 'standard',
          position: { x: -200, y: 100 },
          width: 244,
          height: 100,
          data: { id: APP_BLOCK_ID, type: 'app:acme:sync', title: 'Acme Sync' },
        },
        manualNode(),
      ],
      edges: [inputEdge(APP_BLOCK_ID, MANUAL_ID)],
    }
    const blocking = errors(validateGraphStructure(graph))
    expect(blocking.some((i) => /unknown handle "input"/.test(i.message))).toBe(true)
    expect(blocking.some((i) => /incoming connections/.test(i.message))).toBe(true)
  })
})

describe('edge handle resolution (§4a)', () => {
  it('connectNodes wires a form-input to the manual trigger on the input handles', async () => {
    const graph: DraftGraph = {
      nodes: [secondFormInputNode(), manualNode(), waitNode()],
      edges: [edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Ticket Body',
      to: 'Manual Trigger',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    const wired = persisted.edges.find((e) => e.source === SECOND_FORM_ID)
    expect(wired?.sourceHandle).toBe('input-output')
    expect(wired?.targetHandle).toBe('input')
    // Canvas parity: the trigger's connected-input list gains the node id.
    expect(persisted.nodes.find((n) => n.id === MANUAL_ID)?.data?.inputNodes).toEqual([
      SECOND_FORM_ID,
    ])
  })

  it('a second form-input appends to inputNodes rather than replacing the first', async () => {
    const graph: DraftGraph = {
      nodes: [formInputNode(), secondFormInputNode(), manualNode([FORM_ID]), waitNode()],
      edges: [inputEdge(FORM_ID, MANUAL_ID), edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Ticket Body',
      to: 'Manual Trigger',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    expect(persisted.nodes.find((n) => n.id === MANUAL_ID)?.data?.inputNodes).toEqual([
      FORM_ID,
      SECOND_FORM_ID,
    ])
  })

  /**
   * `isInputNodePair` is strict on the SOURCE side, and app-block node types
   * are uncatalogued permanently (installed apps never ship a manifest). So an
   * app-block aimed at the trigger stays a plain `source` → `target` edge and
   * is rejected exactly as it was before §2 — the exception belongs to
   * catalogued INPUT-category types alone, not to "anything unknown".
   */
  it('an uncatalogued app-block source never mints an input wiring', async () => {
    const APP_BLOCK_ID = 'app-block-aaaaaaaaaaaaaa'
    const graph: DraftGraph = {
      nodes: [
        {
          id: APP_BLOCK_ID,
          type: 'standard',
          position: { x: -200, y: 100 },
          width: 244,
          height: 100,
          data: { id: APP_BLOCK_ID, type: 'app:acme:sync', title: 'Acme Sync' },
        },
        manualNode(),
        waitNode(),
      ],
      edges: [edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Acme Sync',
      to: 'Manual Trigger',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('a non-input source still connects on source → target (and is refused into a trigger)', async () => {
    const graph: DraftGraph = {
      nodes: [manualNode(), waitNode()],
      edges: [edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await connectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Cool Down',
      to: 'Manual Trigger',
    })
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.applied).toBe(false)
    expect(outcome.issues.some((i) => /incoming connections/.test(i.message))).toBe(true)
    expect(serviceUpdate).not.toHaveBeenCalled()
  })

  it('applyTemplate round-trips the shipped template with its input handles intact', async () => {
    const result = await applyTemplate(makeDb({ nodes: [], edges: [] }, null), {
      workflowAppId: APP,
      organizationId: ORG,
      userId: 'user_1',
      templateId: 'file:manual-ticket-triage',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    const inputEdges = persisted.edges.filter((e) => e.targetHandle === 'input')
    expect(inputEdges).toHaveLength(2)
    expect(inputEdges.every((e) => e.sourceHandle === 'input-output')).toBe(true)
    // Template ids are regenerated, so assert the endpoints by node type.
    const typeOf = (id: string) => persisted.nodes.find((n) => n.id === id)?.data?.type
    expect(inputEdges.map((e) => typeOf(e.source))).toEqual(['form-input', 'form-input'])
    expect(inputEdges.map((e) => typeOf(e.target))).toEqual(['manual', 'manual'])
  })
})

describe('inputNodes maintenance (§5)', () => {
  it('deleteNodes on a form-input prunes it from the trigger inputNodes list', async () => {
    const graph: DraftGraph = {
      nodes: [formInputNode(), manualNode([FORM_ID, 'stale-input-node']), waitNode()],
      edges: [inputEdge(FORM_ID, MANUAL_ID), edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await deleteNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      refs: ['Ticket Subject'],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().applied).toBe(true)

    const persisted = persistedGraph()
    expect(persisted.nodes.map((n) => n.id)).toEqual([MANUAL_ID, WAIT_ID])
    // Only the deleted id is pruned — an unrelated stale id is left alone.
    expect(persisted.nodes.find((n) => n.id === MANUAL_ID)?.data?.inputNodes).toEqual([
      'stale-input-node',
    ])
  })

  it('disconnectNodes prunes the unwired input from the trigger inputNodes list', async () => {
    const graph: DraftGraph = {
      nodes: [formInputNode(), manualNode([FORM_ID]), waitNode()],
      edges: [inputEdge(FORM_ID, MANUAL_ID), edge(MANUAL_ID, 'source', WAIT_ID)],
    }
    const result = await disconnectNodes(makeDb(graph), {
      workflowAppId: APP,
      organizationId: ORG,
      from: 'Ticket Subject',
      to: 'Manual Trigger',
    })
    expect(result.isOk()).toBe(true)

    const persisted = persistedGraph()
    expect(persisted.edges.some((e) => e.source === FORM_ID)).toBe(false)
    expect(persisted.nodes.find((n) => n.id === MANUAL_ID)?.data?.inputNodes).toEqual([])
  })

  it('manual advertises `inputs` with no connected inputs — the engine always writes it', () => {
    const variables = manualManifest.resolveOutputs?.(
      { id: MANUAL_ID, type: 'manual', title: 'Manual Trigger', selected: false, inputNodes: [] },
      MANUAL_ID,
      staticOutputContext
    )
    expect(variables?.map((v) => v.id)).toContain(`${MANUAL_ID}.inputs`)
  })
})
