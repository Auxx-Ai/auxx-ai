// apps/web/src/components/workflow/hooks/use-node-addition.ts

import { toastError } from '@auxx/ui/components/toast'
import { useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'
import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types'
import { LOOP_HANDLES } from '../nodes/core/loop/constants'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { storeEventBus } from '../store/event-bus'

import { useWorkflowStore } from '../store/workflow-store'
import { LAYOUT_SPACING } from '../utils/layout-constants'
import {
  applyLaneShifts,
  EdgeManager,
  NodeFactory,
  NodeMover,
  PositionCalculator,
  type PositionResult,
  type Size,
} from '../utils/node-layout'
import { createResizedParentNode } from '../utils/node-resize-utils'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-save-to-history'
import { useWorkflowSave } from './use-workflow-save'
// Variable syncing now handled automatically by VarStoreSyncProvider

export interface NodeAdditionContext {
  nodeType: string
  position: 'after' | 'before' | 'parallel' | 'standalone' | 'between' | 'replace' | 'inside'
  anchorNode?: { id: string; sourceHandle?: string; targetHandle?: string }
  targetNode?: { id: string; targetHandle?: string }
  replaceNodeId?: string
  parentNodeId?: string
  config?: Record<string, any>
  viewport?: { x: number; y: number; zoom: number }
  customPosition?: { x: number; y: number }
  branchType?: string
}

export enum NodeAdditionError {
  INVALID_NODE_TYPE = 'INVALID_NODE_TYPE',
  INVALID_CONNECTION = 'INVALID_CONNECTION',
  CYCLE_DETECTED = 'CYCLE_DETECTED',
  MAX_CONNECTIONS = 'MAX_CONNECTIONS',
  ANCHOR_NODE_NOT_FOUND = 'ANCHOR_NODE_NOT_FOUND',
  HANDLE_NOT_FOUND = 'HANDLE_NOT_FOUND',
}

// Validation helper
function validateNodeAddition(context: NodeAdditionContext): { valid: boolean; error?: string } {
  const { nodeType, position, parentNodeId, replaceNodeId } = context

  // Check if node type exists
  const nodeDefinition = unifiedNodeRegistry.getDefinition(nodeType)
  if (!nodeDefinition) {
    return { valid: false, error: NodeAdditionError.INVALID_NODE_TYPE }
  }

  // Validate position-specific requirements
  if (position === 'inside' && !parentNodeId) {
    return { valid: false, error: 'Parent node ID required for "inside" position' }
  }

  if (position === 'replace' && !replaceNodeId) {
    return { valid: false, error: 'Replace node ID required for "replace" position' }
  }

  return { valid: true }
}

export const useNodeAddition = () => {
  const store = useStoreApi()
  const { debouncedSave } = useWorkflowSave()
  const { saveStateToHistory } = useWorkflowHistory()

  const addNodeWithContext = useCallback(
    async (context: NodeAdditionContext): Promise<string> => {
      const {
        nodeType,
        position,
        anchorNode,
        targetNode,
        replaceNodeId,
        parentNodeId,
        config,
        viewport,
        customPosition,
      } = context

      // Validate the node addition
      const validation = validateNodeAddition(context)
      if (!validation.valid) {
        throw new Error(validation.error)
      }

      // Get current state from store API
      const { nodes: storeNodes, edges } = store.getState()
      const nodes = storeNodes as FlowNode[]

      // Handle replace position for trigger nodes
      if (position === 'replace' && replaceNodeId) {
        return handleReplaceNode(
          replaceNodeId,
          nodeType,
          config,
          nodes,
          edges,
          store,
          debouncedSave,
          saveStateToHistory
        )
      }

      // Calculate node size
      const nodeSize: Size = {
        width:
          nodeType === 'start' || nodeType === 'trigger'
            ? LAYOUT_SPACING.START_NODE_WIDTH
            : LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
        height:
          nodeType === 'start' || nodeType === 'trigger'
            ? LAYOUT_SPACING.START_NODE_HEIGHT
            : LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
      }

      // Calculate position with collision detection (now handles 'inside' too)
      const positionResult = PositionCalculator.calculatePosition({
        position,
        anchorNode,
        targetNode,
        nodes,
        edges,
        viewport,
        customPosition,
        nodeSize,
        parentNodeId,
      })

      // Apply lane shifts if needed (for multi-handle nodes like if-else)
      let workingNodes = nodes
      if (positionResult.laneShift?.required && positionResult.laneShift.config) {
        workingNodes = applyLaneShifts(nodes, positionResult.laneShift.config)
      }

      // Determine loopId based on position
      let loopId: string | undefined
      let isInLoop = false

      switch (position) {
        case 'after':
        case 'before':
          // Check anchor node for loopId
          if (anchorNode) {
            const anchorNodeData = workingNodes.find((n) => n.id === anchorNode.id)
            if (anchorNodeData?.data?.loopId) {
              loopId = anchorNodeData.data.loopId
              isInLoop = true
            }
          }
          break

        case 'between':
          // Check both anchor and target nodes, they should have same loopId
          if (anchorNode && targetNode) {
            const anchorNodeData = workingNodes.find((n) => n.id === anchorNode.id)
            const targetNodeData = workingNodes.find((n) => n.id === targetNode.id)
            if (
              anchorNodeData?.data?.loopId &&
              anchorNodeData.data.loopId === targetNodeData?.data?.loopId
            ) {
              loopId = anchorNodeData.data.loopId
              isInLoop = true
            }
          }
          break

        case 'replace':
          // Inherit loopId from the node being replaced
          if (replaceNodeId) {
            const replacedNode = workingNodes.find((n) => n.id === replaceNodeId)
            if (replacedNode?.data?.loopId) {
              loopId = replacedNode.data.loopId
              isInLoop = true
            }
          }
          break

        case 'inside':
          // For inside position, parentNodeId should be the loop
          if (parentNodeId) {
            loopId = parentNodeId
            isInLoop = true
          }
          break
      }

      // Create the new node with loopId
      // If we have a loopId but no parentNodeId (e.g., adding after/before/between nodes in a loop),
      // set parentId to the loopId to ensure proper containment
      const effectiveParentId = parentNodeId || loopId

      const newNode = NodeFactory.createNode({
        nodeType,
        position: positionResult.position,
        existingNodes: workingNodes,
        data: { ...config, loopId, isInLoop },
        parentId: effectiveParentId,
        parentNode: effectiveParentId
          ? workingNodes.find((n) => n.id === effectiveParentId)
          : undefined,
      })

      try {
        const { setNodes, setEdges } = store.getState()

        // Handle node shifting if needed
        if (position === 'between' && anchorNode && targetNode) {
          // Move nodes apart if needed
          const shiftResult = NodeMover.moveNodesForInsertion(
            anchorNode.id,
            targetNode.id,
            positionResult.position,
            nodeSize,
            workingNodes
          )

          // Use shifted nodes
          const updatedNodes = [...shiftResult.nodes, newNode]
          setNodes(updatedNodes)
        } else {
          // Add the node (workingNodes already includes any lane shifts)
          const updatedNodes = [...workingNodes, newNode]
          setNodes(updatedNodes)
        }

        // Handle parent resize if needed
        if (positionResult.parentContext?.requiresResize && parentNodeId) {
          await handleParentResize(parentNodeId, positionResult.parentContext.suggestedSize!, store)
        }

        // Handle edge creation for 'inside' position
        if (position === 'inside' && parentNodeId) {
          const parentNode = workingNodes.find((n) => n.id === parentNodeId)
          const childNodes = workingNodes.filter((n) => n.parentId === parentNodeId)

          // If this is the first child in a loop, connect it to loop-start
          if (childNodes.length === 0 && parentNode?.data.type === NodeType.LOOP) {
            const loopStartEdge = EdgeManager.createEdge(
              {
                source: parentNodeId,
                sourceHandle: LOOP_HANDLES.LOOP_START,
                target: newNode.id,
                targetHandle: 'target',
                sourceType: 'loop',
                targetType: nodeType,
                isInLoop: true,
                loopId: parentNodeId,
              },
              workingNodes
            )

            const currentNodes = store.getState().nodes as FlowNode[]
            const finalNodes = EdgeManager.updateNodesWithConnectionMetadata(currentNodes, edges, [
              { type: 'add', edge: loopStartEdge },
            ])

            setNodes(finalNodes)
            setEdges([...edges, loopStartEdge])
          }
        }

        // Handle edge creation for non-inside positions
        if (
          position !== 'inside' &&
          (positionResult.edgeInfo || (position === 'between' && anchorNode && targetNode))
        ) {
          await handleEdgeCreation({
            position,
            newNode,
            anchorNode,
            targetNode,
            nodes: workingNodes,
            edges,
            store,
            positionResult,
          })
        }

        // Variable sync is now handled automatically by ReactFlow subscription

        // Update workflow trigger type if we added a trigger node
        const newNodeDefinition = unifiedNodeRegistry.getDefinition(nodeType)
        if (newNodeDefinition?.triggerType) {
          useWorkflowStore.getState().updateTriggerType(newNodeDefinition.triggerType)
        }

        // Save and history
        debouncedSave()
        saveStateToHistory(WorkflowHistoryEvent.NodeAdd)

        return newNode.id
      } catch (error) {
        console.error('[use-node-addition] Error adding node:', error)
        if (error instanceof Error) {
          toastError({ title: 'Failed to add node', description: error.message })
        }
        throw error
      }
    },
    [store, debouncedSave, saveStateToHistory]
  )

  const selectNewNode = useCallback((nodeId: string) => {
    setTimeout(() => {
      storeEventBus.emit({ type: 'selection:changed', data: { nodes: [nodeId], edges: [] } })
    }, 50)
  }, [])

  const closeAllSelectors = useCallback(() => {
    window.dispatchEvent(new CustomEvent('workflow:closeAllSelectors'))
  }, [])

  return { addNode: addNodeWithContext, selectNewNode, closeAllSelectors }
}

// Helper function to handle node replacement
function handleReplaceNode(
  replaceNodeId: string,
  nodeType: string,
  config: Record<string, any> | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
  store: any,
  debouncedSave: () => void,
  saveStateToHistory: (event: WorkflowHistoryEvent) => void
): string {
  const nodeToReplace = nodes.find((n) => n.id === replaceNodeId)
  if (!nodeToReplace) {
    throw new Error(NodeAdditionError.ANCHOR_NODE_NOT_FOUND)
  }

  // Check if we're replacing a trigger or regular node
  const isReplacingTrigger = unifiedNodeRegistry.isTrigger(nodeToReplace.data.type)
  const isNewNodeTrigger = unifiedNodeRegistry.isTrigger(nodeType)

  // Prevent replacing triggers with regular nodes and vice versa
  if (isReplacingTrigger !== isNewNodeTrigger) {
    throw new Error('Cannot replace trigger nodes with regular nodes or vice versa')
  }

  const { setNodes, setEdges } = store.getState()

  // Create new node at same position, preserving loop context
  const newNode = NodeFactory.createNode({
    nodeType,
    position: nodeToReplace.position,
    existingNodes: nodes.filter((n) => n.id !== replaceNodeId),
    data: {
      ...config,
      loopId: nodeToReplace.data?.loopId,
      isInLoop: nodeToReplace.data?.isInLoop,
    },
    parentId: nodeToReplace.parentId,
    parentNode: nodeToReplace.parentId
      ? nodes.find((n) => n.id === nodeToReplace.parentId)
      : undefined,
  })

  // Replace node in edges
  const newEdges = EdgeManager.replaceNodeInEdges(edges, replaceNodeId, newNode.id, nodeType, nodes)

  // Update nodes
  const updatedNodes = nodes.filter((n) => n.id !== replaceNodeId).concat(newNode)

  // Update edges
  const edgeChanges = [
    ...edges
      .filter((e) => e.source === replaceNodeId || e.target === replaceNodeId)
      .map((e) => ({ type: 'remove' as const, edge: e })),
    ...newEdges
      .filter((e) => e.source === newNode.id || e.target === newNode.id)
      .map((e) => ({ type: 'add' as const, edge: e })),
  ]

  // Update nodes with connection metadata
  const finalNodes = EdgeManager.updateNodesWithConnectionMetadata(
    updatedNodes,
    newEdges,
    edgeChanges
  )

  // Single atomic update
  setNodes(finalNodes)
  setEdges(newEdges)

  // Variables are automatically synced by VarStoreSyncProvider

  // Sync any nodes that were connected to the replaced node
  const affectedNodeIds = new Set<string>()
  newEdges.forEach((edge) => {
    if (edge.target !== newNode.id) {
      affectedNodeIds.add(edge.target)
    }
  })

  affectedNodeIds.forEach((nodeId) => {
    // Variables are automatically synced by VarStoreSyncProvider
  })

  // Update workflow trigger type if we replaced a trigger node
  const newNodeDefinition = unifiedNodeRegistry.getDefinition(nodeType)
  if (newNodeDefinition?.triggerType) {
    useWorkflowStore.getState().updateTriggerType(newNodeDefinition.triggerType)
  }

  // Save and history
  debouncedSave()
  saveStateToHistory(WorkflowHistoryEvent.NodeAdd)

  return newNode.id
}

// Helper function to handle parent node resizing
async function handleParentResize(
  parentNodeId: string,
  suggestedSize: { width: number; height: number },
  store: any
): Promise<void> {
  const { nodes, setNodes } = store.getState()

  const updatedNodes = nodes.map((node: FlowNode) => {
    if (node.id === parentNodeId) {
      return createResizedParentNode(node, suggestedSize)
    }
    return node
  })

  setNodes(updatedNodes)
}

// Helper function to handle edge creation
async function handleEdgeCreation(params: {
  position: string
  newNode: FlowNode
  anchorNode?: { id: string; sourceHandle?: string; targetHandle?: string }
  targetNode?: { id: string; targetHandle?: string }
  nodes: FlowNode[]
  edges: FlowEdge[]
  store: any
  positionResult: PositionResult
}): Promise<void> {
  const { position, newNode, anchorNode, targetNode, nodes, edges, store, positionResult } = params
  const { setNodes, setEdges } = store.getState()

  const anchorNodeData = nodes.find((n) => n.id === anchorNode?.id)
  const targetNodeData = nodes.find((n) => n.id === targetNode?.id)

  // Create edges based on position
  const newEdges = EdgeManager.createEdgesForPosition(
    position,
    newNode.id,
    newNode.data.type,
    anchorNode ? { ...anchorNode, type: anchorNodeData?.data.type } : undefined,
    targetNode ? { ...targetNode, type: targetNodeData?.data.type } : undefined,
    { isInLoop: newNode.data.isInLoop || false, loopId: newNode.data.loopId },
    nodes
  )

  // Remove existing edge if inserting between
  if (position === 'between' && anchorNode && targetNode) {
    const existingEdge = EdgeManager.findExistingEdge(
      edges,
      anchorNode.id,
      targetNode.id,
      anchorNode.sourceHandle,
      targetNode.targetHandle
    )

    const updatedEdges = existingEdge
      ? edges.filter((e) => e.id !== existingEdge.id).concat(newEdges)
      : [...edges, ...newEdges]

    setEdges(updatedEdges)
  } else {
    setEdges([...edges, ...newEdges])
  }

  // Update nodes with connection metadata
  const currentNodes = store.getState().nodes as FlowNode[]
  const edgeChanges = newEdges.map((edge) => ({ type: 'add' as const, edge }))
  const finalNodes = EdgeManager.updateNodesWithConnectionMetadata(currentNodes, edges, edgeChanges)
  setNodes(finalNodes)
}
