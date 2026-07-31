// apps/web/src/components/workflow/hooks/use-loop-config.ts

import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { LAYOUT_SPACING } from '~/components/workflow/utils/layout-constants'
import type { FlowEdge, FlowNode } from '../types'

export const useLoopConfig = () => {
  const store = useStoreApi<FlowNode, FlowEdge>()

  const PADDING_X = LAYOUT_SPACING.NODE_HORIZONTAL_PADDING
  const PADDING_Y = LAYOUT_SPACING.NODE_VERTICAL_PADDING
  const handleNodeLoopRerender = useCallback(
    (nodeId: string) => {
      const { nodes, setNodes } = store.getState()

      const currentNode = nodes.find((n) => n.id === nodeId)
      if (!currentNode) return

      let rightNode: FlowNode | undefined
      let bottomNode: FlowNode | undefined

      for (const n of nodes) {
        if (n.parentId !== nodeId) continue
        if (!rightNode || n.position.x + n.width! > rightNode.position.x + rightNode.width!)
          rightNode = n
        if (!bottomNode || n.position.y + n.height! > bottomNode.position.y + bottomNode.height!)
          bottomNode = n
      }

      const rightExtent = rightNode ? rightNode.position.x + rightNode.width! : undefined
      const bottomExtent = bottomNode ? bottomNode.position.y + bottomNode.height! : undefined

      const nextWidth =
        rightExtent !== undefined && currentNode.width! < rightExtent
          ? rightExtent + PADDING_X
          : undefined
      const nextHeight =
        bottomExtent !== undefined && currentNode.height! < bottomExtent
          ? bottomExtent + PADDING_Y
          : undefined

      if (nextWidth === undefined && nextHeight === undefined) return

      const newNodes = produce(nodes, (draft) => {
        const target = draft.find((n) => n.id === nodeId)
        if (!target) return
        if (nextWidth !== undefined) {
          target.data.width = nextWidth
          target.width = nextWidth
        }
        if (nextHeight !== undefined) {
          target.data.height = nextHeight
          target.height = nextHeight
        }
      })

      setNodes(newNodes)
    },
    [store]
  )

  const handleNodeLoopChildDrag = useCallback(
    (node: FlowNode) => {
      const { nodes } = store.getState()

      const restrict: { x?: number; y?: number } = { x: undefined, y: undefined }

      if (node.data.isInLoop) {
        const parentNode = nodes.find((n) => n.id === node.parentId)

        if (parentNode) {
          if (node.position.y < PADDING_Y) restrict.y = PADDING_Y
          if (node.position.x < PADDING_X) restrict.x = PADDING_X
          if (node.position.x + node.width! > parentNode.width! - PADDING_X)
            restrict.x = parentNode.width! - PADDING_X - node.width!
          if (node.position.y + node.height! > parentNode.height! - PADDING_Y)
            restrict.y = parentNode.height! - PADDING_Y - node.height!
        }
      }

      return { restrict }
    },
    [store]
  )

  return { handleNodeLoopRerender, handleNodeLoopChildDrag }
}
