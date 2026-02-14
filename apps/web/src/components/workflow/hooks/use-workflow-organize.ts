// apps/web/src/components/workflow/hooks/use-workflow-organize.ts

import { useReactFlow, useStoreApi } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import type { FlowNode } from '../store/types'
import { useWorkflowStore } from '../store/workflow-store'
import { useHistoryManager } from '../store/workflow-store-provider'
import {
  calculateContainerSize,
  getLayoutByDagre,
  getLayoutForChildNodes,
} from '../utils/layout-algorithms'
import { LAYOUT_ANIMATION, NODE_CLASSIFICATIONS } from '../utils/layout-constants'

/**
 * Hook for organizing workflow layout automatically
 */
export const useWorkflowOrganize = () => {
  const historyManager = useHistoryManager()
  const reactFlow = useReactFlow()
  const store = useStoreApi()
  // Get ReactFlow actions directly
  const setViewport = useCallback((viewport: any) => reactFlow.setViewport(viewport), [reactFlow])
  const fitView = useCallback((options?: any) => reactFlow.fitView(options), [reactFlow])
  const workflow = useWorkflowStore((state) => state.workflow)
  const isDirty = useWorkflowStore((state) => state.isDirty)

  // Check if workflow is in readonly mode
  const isReadOnly = useMemo(() => {
    // Only consider readonly if workflow is explicitly published
    return false // TODO: Check workflow status when available
  }, [workflow])

  /**
   * Main layout organization function
   */
  const handleLayout = useCallback(async () => {
    const { nodes, edges, setEdges, setNodes } = store.getState()
    const nodeCount = nodes.length

    if (isReadOnly || nodeCount === 0) {
      console.warn('Cannot organize layout: workflow is readonly or no nodes present')
      return
    }

    try {
      console.log('🎯 Starting workflow layout organization...', { nodeCount })

      // Start batch operation for history
      historyManager.startBatch('Layout organization')

      // Find container nodes (nodes that can contain other nodes)
      const containerNodes = nodes.filter(
        (node) =>
          NODE_CLASSIFICATIONS.CONTAINER_TYPES.some(
            (type) => node.data?.type?.includes(type) || node.type?.includes(type)
          ) && !node.parentId
      )

      // Calculate layouts for child nodes in containers
      const childLayoutsMap: Record<string, any> = {}
      containerNodes.forEach((node) => {
        childLayoutsMap[node.id] = getLayoutForChildNodes(node.id, nodes, edges)
      })

      // Calculate required container sizes based on child layouts
      const containerSizeChanges: Record<string, { width: number; height: number }> = {}
      containerNodes.forEach((parentNode) => {
        const childLayout = childLayoutsMap[parentNode.id]
        if (childLayout) {
          const requiredSize = calculateContainerSize(parentNode.id, nodes, childLayout)
          containerSizeChanges[parentNode.id] = {
            width: Math.max(parentNode.width || 0, requiredSize.width),
            height: Math.max(parentNode.height || 0, requiredSize.height),
          }
        }
      })

      // Update container node sizes
      const nodesWithUpdatedSizes = nodes.map((node) => {
        if (containerSizeChanges[node.id]) {
          return {
            ...node,
            width: containerSizeChanges[node.id].width,
            height: containerSizeChanges[node.id].height,
            data: {
              ...node.data,
              width: containerSizeChanges[node.id].width,
              height: containerSizeChanges[node.id].height,
            },
          }
        }
        return node
      })

      // Calculate main layout for top-level nodes
      const layout = getLayoutByDagre(nodesWithUpdatedSizes, edges)

      // Create rank map for consistent y-positioning
      const rankMap: Record<string, FlowNode> = {}
      nodesWithUpdatedSizes.forEach((node) => {
        if (!node.parentId) {
          const nodeLayout = layout.node(node.id) as any
          if (nodeLayout?.rank !== undefined) {
            const rank = nodeLayout.rank.toString()
            if (!rankMap[rank] || rankMap[rank].position.y > node.position.y) {
              rankMap[rank] = node
            }
          }
        }
      })

      // Apply new positions to nodes
      const newNodes = nodesWithUpdatedSizes.map((node) => {
        if (!node.parentId) {
          // Position top-level nodes
          const nodeWithPosition = layout.node(node.id)
          if (nodeWithPosition) {
            const rankNode = rankMap[(nodeWithPosition as any).rank?.toString() || '0']
            return {
              ...node,
              position: {
                x: nodeWithPosition.x - (node.width || 244) / 2,
                y: nodeWithPosition.y - (node.height || 100) / 2 + (rankNode?.height || 100) / 2,
              },
            }
          }
        } else {
          // Position child nodes within containers
          const parentNode = containerNodes.find((p) => p.id === node.parentId)
          if (parentNode) {
            const childLayout = childLayoutsMap[parentNode.id]
            if (childLayout) {
              const childNodeWithPosition = childLayout.node(node.id)
              if (childNodeWithPosition) {
                // Calculate relative position within container
                const containerPadding = 20
                return {
                  ...node,
                  position: {
                    x: containerPadding + (childNodeWithPosition.x - (node.width || 244) / 2),
                    y: containerPadding + (childNodeWithPosition.y - (node.height || 100) / 2),
                  },
                }
              }
            }
          }
        }
        return node
      })

      // Update nodes using setNodes
      setNodes(newNodes)

      // Set optimal viewport using canvas interaction callbacks
      setViewport({ x: 0, y: 0, zoom: LAYOUT_ANIMATION.VIEWPORT_ZOOM })

      // Fit view with padding using canvas interaction callbacks
      setTimeout(() => {
        fitView({ padding: 0.1, duration: 200 })
      }, 100)

      // End batch operation
      historyManager.endBatch()

      console.log('✅ Layout organization completed successfully', {
        newNodeCount: newNodes.length,
        updatedPositions: newNodes.map((n) => ({ id: n.id, position: n.position })),
      })
    } catch (error) {
      console.error('Error during layout organization:', error)
      historyManager.endBatch()
    }
  }, [isReadOnly, store, setViewport, fitView, historyManager])

  /**
   * Simple horizontal layout for quick organization
   */
  const handleSimpleLayout = useCallback(() => {
    const { nodes, setNodes } = store.getState()
    const nodeCount = nodes.length

    if (isReadOnly || nodeCount === 0) return

    historyManager.startBatch('Simple layout')

    const spacing = 300
    const newNodes = nodes.map((node, index) => ({
      ...node,
      position: { x: index * spacing, y: 100 },
    }))

    setNodes(newNodes)
    fitView({ padding: 0.1 })
    historyManager.endBatch()
  }, [isReadOnly, store, fitView, historyManager])

  /**
   * Reset all nodes to center position
   */
  const handleResetLayout = useCallback(() => {
    const { nodes, setNodes } = store.getState()
    const nodeCount = nodes.length

    if (isReadOnly || nodeCount === 0) return

    historyManager.startBatch('Reset layout')

    const newNodes = nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } }))

    setNodes(newNodes)
    setViewport({ x: 0, y: 0, zoom: 1 })
    historyManager.endBatch()
  }, [isReadOnly, store, setViewport, historyManager])

  // Memoize canOrganize to prevent unnecessary re-renders
  const canOrganize = useMemo(() => {
    const { nodes } = store.getState()
    return !isReadOnly && nodes.length > 0
  }, [isReadOnly, store])

  return { handleLayout, handleSimpleLayout, handleResetLayout, canOrganize }
}
