// apps/web/src/components/workflow/hooks/use-helpline.ts

import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'
import { useWorkflowStore } from '../store/workflow-store'
// `WorkflowNode` is React Flow's own `Node<BaseNodeData>`, so it carries the
// runtime-measured dimensions (`measured`) that the helpline geometry needs.
import type { WorkflowNode } from '../types'

export const useHelpline = () => {
  const reactFlow = useReactFlow<WorkflowNode>()
  const setHelpLineHorizontal = useWorkflowStore((state) => state.setHelpLineHorizontal)
  const setHelpLineVertical = useWorkflowStore((state) => state.setHelpLineVertical)

  const handleSetHelpline = useCallback(
    (node: WorkflowNode) => {
      // Get nodes directly from ReactFlow state
      // This ensures we have the most up-to-date positions and measured dimensions
      const actualNodes = reactFlow.getNodes()

      // If no nodes available from canvas, skip helpline calculation
      if (actualNodes.length === 0) {
        console.warn('⚠️ No nodes available for helpline calculation from canvas')
        setHelpLineHorizontal(undefined)
        setHelpLineVertical(undefined)
        return { showHorizontalHelpLineNodes: [], showVerticalHelpLineNodes: [] }
      }

      // Filter nodes for helpline calculation (exclude dragged node and special types)
      const alignableNodes = actualNodes.filter((n) => {
        if (n.id === node.id) return false // Exclude the dragged node itself
        if (n.data?.isInIteration) return false
        if (n.data?.isInLoop) return false
        return true
      })

      // Skip helpline calculation if dragged node is in iteration/loop
      if (node.data?.isInIteration || node.data?.isInLoop) {
        setHelpLineHorizontal(undefined)
        setHelpLineVertical(undefined)
        return { showHorizontalHelpLineNodes: [], showVerticalHelpLineNodes: [] }
      }

      // Calculate horizontal helplines (nodes with similar Y position)
      const showHorizontalHelpLineNodes = alignableNodes
        .filter((n) => {
          const nY = Math.ceil(n.position.y)
          const nodeY = Math.ceil(node.position.y)
          const diff = nY - nodeY
          return diff < 5 && diff > -5
        })
        .sort((a, b) => a.position.x - b.position.x)

      const horizontalFirst = showHorizontalHelpLineNodes[0]
      const horizontalLast = showHorizontalHelpLineNodes[showHorizontalHelpLineNodes.length - 1]
      if (horizontalFirst && horizontalLast) {
        const helpLine = {
          top: horizontalFirst.position.y,
          left: horizontalFirst.position.x,
          width:
            horizontalLast.position.x +
            (horizontalLast.measured?.width || 200) -
            horizontalFirst.position.x,
        }

        if (node.position.x < horizontalFirst.position.x) {
          helpLine.left = node.position.x
          helpLine.width =
            horizontalFirst.position.x + (horizontalFirst.measured?.width || 200) - node.position.x
        }

        if (node.position.x > horizontalLast.position.x)
          helpLine.width =
            node.position.x + (node.measured?.width || 200) - horizontalFirst.position.x

        setHelpLineHorizontal(helpLine)
      } else {
        setHelpLineHorizontal(undefined)
      }

      // Calculate vertical helplines (nodes with similar X position)
      const showVerticalHelpLineNodes = alignableNodes
        .filter((n) => {
          const nX = Math.ceil(n.position.x)
          const nodeX = Math.ceil(node.position.x)
          const diff = nX - nodeX
          return diff < 5 && diff > -5
        })
        .sort((a, b) => a.position.y - b.position.y) // Sort by Y for vertical lines

      const verticalFirst = showVerticalHelpLineNodes[0]
      const verticalLast = showVerticalHelpLineNodes[showVerticalHelpLineNodes.length - 1]
      if (verticalFirst && verticalLast) {
        const helpLine = {
          top: verticalFirst.position.y,
          left: verticalFirst.position.x,
          height:
            verticalLast.position.y +
            (verticalLast.measured?.height || 100) -
            verticalFirst.position.y,
        }

        if (node.position.y < verticalFirst.position.y) {
          helpLine.top = node.position.y
          helpLine.height =
            verticalFirst.position.y + (verticalFirst.measured?.height || 100) - node.position.y
        }

        if (node.position.y > verticalLast.position.y)
          helpLine.height =
            node.position.y + (node.measured?.height || 100) - verticalFirst.position.y

        setHelpLineVertical(helpLine)
      } else {
        setHelpLineVertical(undefined)
      }

      return { showHorizontalHelpLineNodes, showVerticalHelpLineNodes }
    },
    [reactFlow, setHelpLineHorizontal, setHelpLineVertical]
  )

  // Handler to clear helplines
  const handleClearHelpline = useCallback(() => {
    setHelpLineHorizontal(undefined)
    setHelpLineVertical(undefined)
  }, [setHelpLineHorizontal, setHelpLineVertical])

  return { handleSetHelpline, handleClearHelpline }
}
