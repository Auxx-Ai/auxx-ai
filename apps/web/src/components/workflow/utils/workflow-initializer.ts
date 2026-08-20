// apps/web/src/components/workflow/utils/workflow-initializer.ts

import {
  errorHandlingBranches,
  type GraphDocument,
  getManifest,
  hydrateGraph,
  type TargetBranch,
} from '@auxx/lib/workflow-engine/client'
import { getConnectedEdges } from '@xyflow/react'
import type { IfElseNodeData } from '../nodes/core/if-else/types'
import type { LoopNodeData } from '../nodes/core/loop/types'
import type { TextClassifierNodeData } from '../nodes/core/text-classifier/types'
import type { FlowEdge, FlowNode } from '../types'
import { NodeType } from '../types/node-types'
import { branchNameCorrect } from './branch-name-correct'

/**
 * Calculate target branches based on node type and current data.
 *
 * Derived state — `_targetBranches` is stripped on every save and rebuilt
 * here on load. The authoritative derivation is each manifest's
 * `connection.branches(config)`; the remaining arms mirror it and should
 * collapse into it (see `catalog/derived-keys.ts`). The failure-policy half
 * already has: it reads the manifest rather than switching on a type.
 */
export const calculateTargetBranches = (nodeData: FlowNode['data']): TargetBranch[] | undefined => {
  switch (nodeData.type) {
    case NodeType.IF_ELSE: {
      const ifElseData = nodeData as IfElseNodeData
      // Build branches from cases + ELSE branch
      const branches: TargetBranch[] = [
        ...(ifElseData.cases || []).map((c) => ({
          id: c.case_id,
          name: '',
          type: 'default' as const,
        })),
        { id: 'false', name: '', type: 'default' as const },
      ]
      // Apply proper naming (IF/ELSE for 2 branches, CASE 1/2/ELSE for multiple)
      return branchNameCorrect(branches)
    }

    case NodeType.TEXT_CLASSIFIER: {
      const classifierData = nodeData as TextClassifierNodeData
      if (classifierData.outputMode === 'variable') {
        return [{ id: 'source', name: '', type: 'default' }]
      }
      // Branches mode (default): categories + unmatched
      if (classifierData.categories) {
        return [
          ...classifierData.categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            type: 'default' as const,
          })),
          { id: 'unmatched', name: 'Unmatched', type: 'default' },
        ]
      }
      return undefined
    }

    default: {
      // The HTTP and CRUD arms that used to live here existed ONLY to add the
      // `fail` branch, and they were two copies of one rule — which is how
      // crud's graph-builder arm came to be missing while every other surface
      // declared the handle (plan 21 §7.3). Failure policy is now a
      // manifest-declared concern: a type contributes a `fail` branch because
      // its manifest says it handles failures, not because this switch has a
      // case for it.
      if (!getManifest(nodeData.type)?.errorHandling) return undefined
      return [
        { id: 'source', name: '', type: 'default' },
        // `NodeBranch.kind` and `TargetBranch.type` are the same union under
        // two names; this is the only place they meet.
        ...errorHandlingBranches(nodeData).map((branch) => ({
          id: branch.id,
          name: branch.name,
          type: branch.kind,
        })),
      ]
    }
  }
}

/**
 * Stored graph → canvas graph.
 *
 * A THIN WRAPPER over the shared hydrator (`@auxx/lib/workflow-engine/client`
 * `hydrateGraph`) plus the four derivations that are genuinely React-Flow-only.
 * Everything else this function used to compute — `node.type`, `node.extent`,
 * `data.id`/`isInLoop`/`loopId`, `edge.data.sourceType`/`targetType`/
 * `isInLoop`/`loopId`/`isLoopBackEdge`, handle defaults, `edge.zIndex`, and
 * the legacy `app-trigger` type rewrite — now lives in the hydrator, which the
 * engine and `graph-edit` call too. Three surfaces used to hold three separate
 * opinions about what a loop-back edge is
 * (`plans/kopilot/workflow/23-graph-document-canonicalization.md` §9).
 *
 * The hydrator also layers `manifest.defaultData()` UNDER stored data, so a
 * default is a read-time projection rather than a panel write (23 §2.4). It
 * resolves types through the CORE registry, which answers for the ~29 platform
 * types; an app block's declared defaults are simply not layered here, exactly
 * as before.
 *
 * What stays in web, and why:
 *
 * | key | why it cannot move |
 * |---|---|
 * | `data._connectedSourceHandleIds` | `@xyflow/react`'s `getConnectedEdges` |
 * | `data._connectedTargetHandleIds` | same |
 * | `data._targetBranches` | rendered through web's `branchNameCorrect` |
 * | `data._children` (loop containers) | canvas-only child list |
 *
 * All four are `_`-prefixed, so the write seam strips them either way.
 */
export const initializeWorkflow = (
  nodes: FlowNode[],
  edges: FlowEdge[]
): { nodes: FlowNode[]; edges: FlowEdge[] } => {
  // `FlowNode.extent` is React Flow's `'parent' | CoordinateExtent | null`
  // while the document's is a plain string, so the two structural types are
  // not mutually assignable. The values are identical; only the declarations
  // disagree.
  const hydrated = hydrateGraph({ nodes, edges } as unknown as GraphDocument)
  const hydratedNodes = hydrated.nodes as unknown as FlowNode[]
  const hydratedEdges = hydrated.edges as unknown as FlowEdge[]

  return {
    nodes: applyCanvasDerivations(hydratedNodes, hydratedEdges),
    edges: hydratedEdges,
  }
}

/**
 * The React-Flow-only half of {@link initializeWorkflow} — the four `_`-keys
 * the shared hydrator deliberately leaves to web (see its "What this file does
 * NOT do" block).
 *
 * Expects ALREADY-HYDRATED nodes and edges: `_targetBranches` reads
 * `data.type`, and the handle lists read the edges' resolved handles.
 */
export const applyCanvasDerivations = (nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] => {
  // Loop containers list their children for the canvas; the hydrator owns the
  // reverse direction (`data.isInLoop` / `data.loopId` on the child).
  const childrenMap = nodes.reduce(
    (acc, node) => {
      if (node.parentId) {
        const children = acc[node.parentId] ?? []
        children.push({ nodeId: node.id, nodeType: node.data.type })
        acc[node.parentId] = children
      }
      return acc
    },
    {} as Record<string, Array<{ nodeId: string; nodeType: string }>>
  )

  return nodes.map((node) => {
    const updatedNode = { ...node, data: { ...node.data } }

    const connectedEdges = getConnectedEdges([node], edges)

    updatedNode.data._connectedSourceHandleIds = connectedEdges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.sourceHandle || 'source')

    updatedNode.data._connectedTargetHandleIds = connectedEdges
      .filter((edge) => edge.target === node.id)
      .map((edge) => edge.targetHandle || 'target')

    const targetBranches = calculateTargetBranches(updatedNode.data)
    if (targetBranches) {
      updatedNode.data._targetBranches = targetBranches
    }

    if (node.data.type === NodeType.LOOP) {
      const loopData = updatedNode.data as LoopNodeData
      loopData._children = childrenMap[node.id] || []
    }

    return updatedNode
  })
}

/**
 * Detect cycles in the workflow graph
 * Returns array of edge IDs that form cycles
 */
export const getCycleEdges = (nodes: FlowNode[], edges: FlowEdge[]): string[] => {
  const cycleEdges: string[] = []
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  // Build adjacency list
  const adjacencyList = edges.reduce(
    (acc, edge) => {
      if (!acc[edge.source]) {
        acc[edge.source] = []
      }
      acc[edge.source]!.push({ target: edge.target, edgeId: edge.id })
      return acc
    },
    {} as Record<string, Array<{ target: string; edgeId: string }>>
  )

  // DFS to detect cycles
  const hasCycle = (nodeId: string, path: string[] = []): boolean => {
    visited.add(nodeId)
    recursionStack.add(nodeId)

    const neighbors = adjacencyList[nodeId] || []
    for (const { target, edgeId } of neighbors) {
      // Skip if this edge connects to a loop node (loop back edges are allowed)
      const targetNode = nodes.find((n) => n.id === target)
      if (targetNode?.data.type === NodeType.LOOP) {
        continue
      }

      if (!visited.has(target)) {
        if (hasCycle(target, [...path, edgeId])) {
          return true
        }
      } else if (recursionStack.has(target)) {
        // Found a cycle - add the edge that completes the cycle
        cycleEdges.push(edgeId)
        return true
      }
    }

    recursionStack.delete(nodeId)
    return false
  }

  // Check each unvisited node
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      hasCycle(node.id)
    }
  })

  return cycleEdges
}

/**
 * Validate if nodes and edges have required initialization properties
 */
export const validateInitialization = (
  nodes: FlowNode[],
  edges: FlowEdge[]
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  // Check nodes
  nodes.forEach((node) => {
    if (!node.data._connectedSourceHandleIds) {
      errors.push(`Node ${node.id} missing _connectedSourceHandleIds`)
    }
    if (!node.data._connectedTargetHandleIds) {
      errors.push(`Node ${node.id} missing _connectedTargetHandleIds`)
    }

    // Check node-specific requirements
    if (node.data.type === NodeType.LOOP) {
      const loopData = node.data as LoopNodeData
      if (!loopData._children) {
        errors.push(`Loop node ${node.id} missing _children`)
      }
    }

    // Check _targetBranches for nodes that should have them
    if ([NodeType.IF_ELSE, NodeType.TEXT_CLASSIFIER].includes(node.data.type as NodeType)) {
      if (!node.data._targetBranches) {
        errors.push(`Node ${node.id} (${node.data.type}) missing _targetBranches`)
      }
    }
  })

  // Check edges
  edges.forEach((edge) => {
    if (!edge.data) {
      errors.push(`Edge ${edge.id} missing data object`)
    } else {
      if (!edge.data.sourceType) {
        errors.push(`Edge ${edge.id} missing sourceType`)
      }
      if (!edge.data.targetType) {
        errors.push(`Edge ${edge.id} missing targetType`)
      }
    }
  })

  return { valid: errors.length === 0, errors }
}
