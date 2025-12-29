import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { FlowNode } from '../store/types'
import { useWorkflowStore } from '../store/workflow-store'

export const useHelpline = () => {
  const reactFlow = useReactFlow()
  const setHelpLineHorizontal = useWorkflowStore((state) => state.setHelpLineHorizontal)
  const setHelpLineVertical = useWorkflowStore((state) => state.setHelpLineVertical)

  const handleSetHelpline = useCallback(
    (node: FlowNode) => {
      // Get nodes directly from ReactFlow state
      // This ensures we have the most up-to-date positions and measured dimensions
      const actualNodes = reactFlow.getNodes() as FlowNode[]

      // If no nodes available from canvas, skip helpline calculation
      if (actualNodes.length === 0) {
        console.warn('⚠️ No nodes available for helpline calculation from canvas')
        setHelpLineHorizontal(undefined)
        setHelpLineVertical(undefined)
        return { showHorizontalHelpLineNodes: [], showVerticalHelpLineNodes: [] }
      }

      // Filter nodes for helpline calculation (exclude dragged node and special types)
      const alignableNodes = actualNodes.filter((n: FlowNode) => {
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
        .filter((n: FlowNode) => {
          const nY = Math.ceil(n.position.y)
          const nodeY = Math.ceil(node.position.y)
          const diff = nY - nodeY
          return diff < 5 && diff > -5
        })
        .sort((a: FlowNode, b: FlowNode) => a.position.x - b.position.x)

      const showHorizontalHelpLineNodesLength = showHorizontalHelpLineNodes.length
      if (showHorizontalHelpLineNodesLength > 0) {
        const first = showHorizontalHelpLineNodes[0]
        const last = showHorizontalHelpLineNodes[showHorizontalHelpLineNodesLength - 1]

        const helpLine = {
          top: first.position.y,
          left: first.position.x,
          width: last.position.x + (last.measured?.width || 200) - first.position.x,
        }

        if (node.position.x < first.position.x) {
          helpLine.left = node.position.x
          helpLine.width = first.position.x + (first.measured?.width || 200) - node.position.x
        }

        if (node.position.x > last.position.x)
          helpLine.width = node.position.x + (node.measured?.width || 200) - first.position.x

        setHelpLineHorizontal(helpLine)
      } else {
        setHelpLineHorizontal(undefined)
      }

      // Calculate vertical helplines (nodes with similar X position)
      const showVerticalHelpLineNodes = alignableNodes
        .filter((n: FlowNode) => {
          const nX = Math.ceil(n.position.x)
          const nodeX = Math.ceil(node.position.x)
          const diff = nX - nodeX
          return diff < 5 && diff > -5
        })
        .sort((a: FlowNode, b: FlowNode) => a.position.y - b.position.y) // Sort by Y for vertical lines
      const showVerticalHelpLineNodesLength = showVerticalHelpLineNodes.length

      if (showVerticalHelpLineNodesLength > 0) {
        const first = showVerticalHelpLineNodes[0]
        const last = showVerticalHelpLineNodes[showVerticalHelpLineNodesLength - 1]

        const helpLine = {
          top: first.position.y,
          left: first.position.x,
          height: last.position.y + (last.measured?.height || 100) - first.position.y,
        }

        if (node.position.y < first.position.y) {
          helpLine.top = node.position.y
          helpLine.height = first.position.y + (first.measured?.height || 100) - node.position.y
        }

        if (node.position.y > last.position.y)
          helpLine.height = node.position.y + (node.measured?.height || 100) - first.position.y

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
