// packages/lib/src/workflow-engine/core/__tests__/workflow-graph-builder.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { NodeProcessorRegistry } from '../node-processor-registry'
import { NodeRunningStatus, WorkflowNodeType } from '../types'
import { WorkflowGraphBuilder, WorkflowGraphHelper } from '../workflow-graph-builder'

describe('WorkflowGraphBuilder', () => {
  let nodeRegistry: NodeProcessorRegistry

  beforeEach(() => {
    nodeRegistry = new NodeProcessorRegistry()
    // Register mock processors for testing
    nodeRegistry.registerProcessor({
      type: WorkflowNodeType.MANUAL,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node) => ({
        nodeId: node.nodeId,
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    })
    nodeRegistry.registerProcessor({
      type: WorkflowNodeType.VARIABLE_SET,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node) => ({
        nodeId: node.nodeId,
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    })
    nodeRegistry.registerProcessor({
      type: WorkflowNodeType.END,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node) => ({
        nodeId: node.nodeId,
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    })
    nodeRegistry.registerProcessor({
      type: WorkflowNodeType.LOOP,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node) => ({
        nodeId: node.nodeId,
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    })

    WorkflowGraphBuilder.initialize(nodeRegistry)
  })

  describe('node filtering', () => {
    it('should filter out note nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'note', data: { type: 'note', content: 'This is a note' } },
            { id: 'node3', type: 'variable-set', data: { type: 'variable-set' } },
          ],
          edges: [{ id: 'edge1', source: 'node1', target: 'node3' }],
        },
      }

      const { graph, workflow: transformed } = WorkflowGraphBuilder.build(workflow)

      expect(graph.nodes.size).toBe(2)
      expect(graph.nodes.has('node1')).toBe(true)
      expect(graph.nodes.has('node2')).toBe(false)
      expect(graph.nodes.has('node3')).toBe(true)
      expect(transformed.nodes.length).toBe(2)
    })

    it('should filter out nodes without processors', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'unknown-type', data: { type: 'unknown-type' } },
            { id: 'node3', type: 'variable-set', data: { type: 'variable-set' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(2)
      expect(graph.nodes.has('node1')).toBe(true)
      expect(graph.nodes.has('node2')).toBe(false)
      expect(graph.nodes.has('node3')).toBe(true)
    })

    it('should keep all executable nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'node3', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(3)
      expect(graph.nodes.has('node1')).toBe(true)
      expect(graph.nodes.has('node2')).toBe(true)
      expect(graph.nodes.has('node3')).toBe(true)
    })
  })

  describe('disabled node handling', () => {
    it('should create simple bypass for linear disabled nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set', disabled: true } },
            { id: 'node3', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(2)
      expect(graph.nodes.has('node2')).toBe(false)

      // Check bypass edge was created
      const edges = graph.edgesBySourceHandle.get('node1:source')
      expect(edges).toBeDefined()
      expect(edges?.length).toBe(1)
      expect(edges?.[0]?.target).toBe('node3')
    })

    it('should handle chain of disabled nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set', disabled: true } },
            { id: 'node3', type: 'variable-set', data: { type: 'variable-set', disabled: true } },
            { id: 'node4', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
            { id: 'edge3', source: 'node3', target: 'node4' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(2)
      expect(graph.nodes.has('node1')).toBe(true)
      expect(graph.nodes.has('node4')).toBe(true)

      // Check bypass edge spans all disabled nodes
      const edges = graph.edgesBySourceHandle.get('node1:source')
      expect(edges?.[0]?.target).toBe('node4')
    })

    it('should preserve edge handles during bypass', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set', disabled: true } },
            { id: 'node3', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            {
              id: 'edge1',
              source: 'node1',
              target: 'node2',
              sourceHandle: 'custom',
              targetHandle: 'input',
            },
            {
              id: 'edge2',
              source: 'node2',
              target: 'node3',
              sourceHandle: 'output',
              targetHandle: 'target',
            },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      const edges = graph.edgesBySourceHandle.get('node1:custom')
      expect(edges).toBeDefined()
      expect(edges?.[0]?.sourceHandle).toBe('custom')
      expect(edges?.[0]?.targetHandle).toBe('target')
    })

    it('should handle complex disabled node scenarios', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set', disabled: true } },
            { id: 'node3', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'node4', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'node5', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
            { id: 'edge3', source: 'node2', target: 'node4' },
            { id: 'edge4', source: 'node3', target: 'node5' },
            { id: 'edge5', source: 'node4', target: 'node5' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(4)
      expect(graph.nodes.has('node2')).toBe(false)

      // Should create bypass edges for each outgoing edge from disabled node
      const edges = graph.edgesBySourceHandle.get('node1:source')
      expect(edges?.length).toBe(2)
      const targets = edges?.map((e: any) => e.target).sort()
      expect(targets).toEqual(['node3', 'node4'])
    })
  })

  describe('data transformation', () => {
    it('should transform React Flow format to engine format', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            {
              id: 'node1',
              type: 'manual',
              position: { x: 100, y: 100 },
              data: {
                type: 'manual',
                title: 'Start',
                // `desc` is THE node description. The vestigial `data.description`
                // alias was removed from `baseNodeDataSchema` (plan 23 §2.2) — it
                // had zero readers and hid the real field from Kopilot summaries.
                desc: 'Test node',
                customField: 'value',
              },
            },
          ],
          edges: [],
        },
      }

      const { workflow: transformed } = WorkflowGraphBuilder.build(workflow)

      expect(transformed.nodes[0]).toMatchObject({
        id: 'node1',
        nodeId: 'node1',
        workflowId: 'test-workflow',
        type: 'manual',
        name: 'Start',
        description: 'Test node',
        data: {
          customField: 'value',
        },
      })
    })

    it('should handle missing node names', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [{ id: 'node1', type: 'manual', data: { type: 'manual' } }],
          edges: [],
        },
      }

      const { workflow: transformed } = WorkflowGraphBuilder.build(workflow)

      expect(transformed.nodes[0]?.name).toBe('manual-ode1')
    })

    it('should preserve node data', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            {
              id: 'node1',
              type: 'variable-set',
              data: {
                type: 'variable-set',
                variables: [
                  { name: 'var1', value: 'value1' },
                  { name: 'var2', value: 'value2' },
                ],
              },
            },
          ],
          edges: [],
        },
      }

      const { workflow: transformed } = WorkflowGraphBuilder.build(workflow)

      expect(transformed.nodes[0]?.data.variables).toHaveLength(2)
      expect(transformed.nodes[0]?.data.variables[0]).toEqual({ name: 'var1', value: 'value1' })
    })

    it('should extract metadata correctly', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            {
              id: 'node1',
              type: 'manual',
              position: { x: 100, y: 200 },
              data: {
                type: 'manual',
                metadata: { custom: 'value' },
              },
            },
          ],
          edges: [],
        },
      }

      const { workflow: transformed } = WorkflowGraphBuilder.build(workflow)

      expect(transformed.nodes[0]?.metadata).toMatchObject({
        position: { x: 100, y: 200 },
        custom: 'value',
      })
    })
  })

  describe('error handling', () => {
    it('should handle null workflow gracefully', () => {
      expect(() => WorkflowGraphBuilder.buildGraph(null as any)).toThrow()
    })

    it('should handle workflows without graph property', () => {
      const workflow = {
        id: 'test-workflow',
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.nodes.size).toBe(0)
      expect(graph.edgesBySourceHandle.size).toBe(0)
    })

    it('should handle missing node registry gracefully', () => {
      // Reset the builder without a registry
      WorkflowGraphBuilder.initialize(null as any)

      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [{ id: 'node1', type: 'manual', data: { type: 'manual' } }],
          edges: [],
        },
      }

      // Should not throw, but might filter out nodes
      expect(() => WorkflowGraphBuilder.buildGraph(workflow)).not.toThrow()
    })
  })

  describe('graph metadata', () => {
    it('should detect loops correctly', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'loop', data: { type: 'loop' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set' } },
          ],
          edges: [
            {
              id: 'edge1',
              source: 'node1',
              target: 'node2',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'edge2',
              source: 'node2',
              target: 'node1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.hasCycles).toBe(false) // loop-back edges are not considered cycles
    })

    it('should find entry and exit nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'node1', type: 'manual', data: { type: 'manual' } },
            { id: 'node2', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'node3', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            { id: 'edge1', source: 'node1', target: 'node2' },
            { id: 'edge2', source: 'node2', target: 'node3' },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      expect(graph.entryNodes).toContain('node1')
      expect(graph.terminalNodes).toContain('node3')
    })
  })

  describe('loop node routing', () => {
    it('should route from source handle to downstream nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'trigger', type: 'manual', data: { type: 'manual' } },
            { id: 'loop-1', type: 'loop', data: { type: 'loop' } },
            { id: 'body-1', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'end-1', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            {
              id: 'e1',
              source: 'trigger',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e-loop-start',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'loop-1',
              target: 'end-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      // Verify loop node exists
      expect(graph.nodes.has('loop-1')).toBe(true)

      // Verify getNextNodes finds the end node when using source handle
      const nextNodes = WorkflowGraphHelper.getNextNodes(graph, 'loop-1', 'source')

      expect(nextNodes).toBeDefined()
      expect(nextNodes.length).toBe(1)
      expect(nextNodes[0]?.nodeId).toBe('end-1')
    })

    it('should register loop-start and source handles for loop nodes', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'loop-1', type: 'loop', data: { type: 'loop' } },
            { id: 'body-1', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'end-1', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'loop-1',
              target: 'end-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      // Verify both handles are registered
      const loopStartNodes = WorkflowGraphHelper.getNextNodes(graph, 'loop-1', 'loop-start')
      const loopExitNodes = WorkflowGraphHelper.getNextNodes(graph, 'loop-1', 'source')

      expect(loopStartNodes.length).toBe(1)
      expect(loopStartNodes[0]?.nodeId).toBe('body-1')

      expect(loopExitNodes.length).toBe(1)
      expect(loopExitNodes[0]?.nodeId).toBe('end-1')
    })

    it('should fallback to source handle when using invalid handle on loop node', () => {
      const workflow = {
        id: 'test-workflow',
        graph: {
          nodes: [
            { id: 'loop-1', type: 'loop', data: { type: 'loop' } },
            { id: 'body-1', type: 'variable-set', data: { type: 'variable-set' } },
            { id: 'end-1', type: 'end', data: { type: 'end' } },
          ],
          edges: [
            {
              id: 'e-loop-start',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e1',
              source: 'loop-1',
              target: 'end-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
        },
      }

      const graph = WorkflowGraphBuilder.buildGraph(workflow)

      // Using an invalid handle (loop-exit) falls back to 'source' handle
      // per getNextNodes implementation, which returns the source-connected node
      const nextNodes = WorkflowGraphHelper.getNextNodes(graph, 'loop-1', 'loop-exit')

      // Should fallback to 'source' handle and return end-1
      expect(nextNodes.length).toBe(1)
      expect(nextNodes[0]?.nodeId).toBe('end-1')
    })
  })
})

describe('WorkflowGraphBuilder.getNodeHandles — crud declares a fail branch (plan 21 §7.3)', () => {
  beforeEach(() => {
    const registry = new NodeProcessorRegistry()
    for (const type of [WorkflowNodeType.CRUD, WorkflowNodeType.HTTP]) {
      registry.registerProcessor({
        type,
        preprocessNode: async () => ({ inputs: {}, metadata: {} }),
        execute: async (node) => ({
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: {},
          executionTime: 0,
        }),
        validate: async () => ({ valid: true, errors: [], warnings: [] }),
      })
    }
    WorkflowGraphBuilder.initialize(registry)
  })

  /** The handle ids the builder registered for the one node in this workflow. */
  function handlesFor(data: Record<string, unknown>): string[] {
    const graph = WorkflowGraphBuilder.buildGraph({
      id: 'wf',
      graph: {
        nodes: [{ id: 'n1', type: data.type as string, data }],
        edges: [],
      },
    } as never)
    return [...(graph.nodes.get('n1')?.outputHandles.keys() ?? [])]
  }

  it("registers `fail` for crud with error_strategy 'fail', mirroring http", () => {
    // `crud` declares this branch in its manifest, renders it in node.tsx, gets
    // it from calculateTargetBranches and emits `outputHandle: 'fail'` from its
    // processor — but had no arm here, so it fell to `default:` and registered
    // `source` alone. The derived metadata then lied: `hasMultipleOutputs:
    // false` and the fail edge invisible to fork/parallel accounting.
    expect(handlesFor({ type: 'crud', error_strategy: 'fail' })).toEqual(['source', 'fail'])
    expect(handlesFor({ type: 'http', error_strategy: 'fail' })).toEqual(['source', 'fail'])
  })

  it('registers `source` alone when the fail branch is not enabled', () => {
    expect(handlesFor({ type: 'crud', error_strategy: 'continue' })).toEqual(['source'])
    expect(handlesFor({ type: 'crud' })).toEqual(['source'])
  })
})

/**
 * The fail handle is MANIFEST-DRIVEN, not a per-type `case`.
 *
 * `getNodeHandles` used to carry `case 'http':` / `case 'crud':` arms whose
 * only job was this handle, and crud's was missing for a long time — which is
 * exactly the failure mode a per-type switch invites (plan 21 §7.3). The
 * handle now comes from the manifest's `errorHandling` declaration, so the
 * omission is unrepresentable rather than patched.
 */
describe('WorkflowGraphBuilder.getNodeHandles — errorHandling is read off the manifest', () => {
  beforeEach(() => {
    const registry = new NodeProcessorRegistry()
    for (const type of [
      WorkflowNodeType.CRUD,
      WorkflowNodeType.HTTP,
      WorkflowNodeType.AI,
      WorkflowNodeType.FORMAT,
      WorkflowNodeType.WAIT,
    ]) {
      registry.registerProcessor({
        type,
        preprocessNode: async () => ({ inputs: {}, metadata: {} }),
        execute: async (node) => ({
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: {},
          executionTime: 0,
        }),
        validate: async () => ({ valid: true, errors: [], warnings: [] }),
      })
    }
    WorkflowGraphBuilder.initialize(registry)
  })

  function handlesFor(data: Record<string, unknown>): string[] {
    const graph = WorkflowGraphBuilder.buildGraph({
      id: 'wf',
      graph: { nodes: [{ id: 'n1', type: data.type as string, data }], edges: [] },
    } as never)
    return [...(graph.nodes.get('n1')?.outputHandles.keys() ?? [])]
  }

  it('registers the fail handle for every type that declares errorHandling', () => {
    expect(handlesFor({ type: 'http', error_strategy: 'fail' })).toEqual(['source', 'fail'])
    expect(handlesFor({ type: 'crud', error_strategy: 'fail' })).toEqual(['source', 'fail'])
  })

  it("reads http's legacy `none` spelling as continue, so no fail handle appears", () => {
    expect(handlesFor({ type: 'http', error_strategy: 'none' })).toEqual(['source'])
  })

  it('registers it for the step-4 opt-ins too, with no new arm', () => {
    // `ai` joined in PR B (plan 21 §18.1) and needed no code here — declaring
    // `errorHandling` on the manifest is the whole change.
    expect(handlesFor({ type: 'ai', error_strategy: 'fail' })).toEqual(['source', 'fail'])
  })

  it('gives NO fail handle to a type that does not declare errorHandling', () => {
    // `format` deliberately stays out (a format failure IS a config bug), so a
    // config that sets `error_strategy` anyway must not conjure a branch — the
    // declaration is what grants the handle, not the presence of the field.
    expect(handlesFor({ type: 'format', error_strategy: 'fail' })).toEqual(['source'])
  })

  it('gives NO fail handle to an opted-in type whose node carries no key', () => {
    // The behaviour-preservation case: every persisted `ai` row predates the
    // opt-in and has no `error_strategy`, so it must register exactly the
    // handles it always did.
    expect(handlesFor({ type: 'ai' })).toEqual(['source'])
  })

  it('leaves a type-specific arm alone when the type has no declaration', () => {
    // `wait` keeps its own arm in the switch; the post-switch manifest pass is
    // orthogonal to the branch-shape arms and adds nothing here.
    expect(handlesFor({ type: 'wait', error_strategy: 'fail' })).toEqual(['source'])
  })
})
