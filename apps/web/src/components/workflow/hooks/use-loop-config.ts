import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { LAYOUT_SPACING } from '~/components/workflow/utils/layout-constants'
import type { FlowNode } from '../types'

export const useLoopConfig = () => {
  const store = useStoreApi()

  const PADDING_X = LAYOUT_SPACING.NODE_HORIZONTAL_PADDING
  const PADDING_Y = LAYOUT_SPACING.NODE_VERTICAL_PADDING
  const handleNodeLoopRerender = useCallback(
    (nodeId: string) => {
      const { nodes, setNodes } = store.getState()

      const currentNode = nodes.find((n) => n.id === nodeId)!
      const childrenNodes = nodes.filter((n) => n.parentId === nodeId)
      let rightNode: FlowNode
      let bottomNode: Node

      childrenNodes.forEach((n) => {
        if (rightNode) {
          if (n.position.x + n.width! > rightNode.position.x + rightNode.width!) rightNode = n
        } else {
          rightNode = n
        }
        if (bottomNode) {
          if (n.position.y + n.height! > bottomNode.position.y + bottomNode.height!) bottomNode = n
        } else {
          bottomNode = n
        }
      })

      const widthShouldExtend =
        rightNode! && currentNode.width! < rightNode.position.x + rightNode.width!
      const heightShouldExtend =
        bottomNode! && currentNode.height! < bottomNode.position.y + bottomNode.height!

      if (widthShouldExtend || heightShouldExtend) {
        const newNodes = produce(nodes, (draft) => {
          draft.forEach((n) => {
            if (n.id === nodeId) {
              if (widthShouldExtend) {
                n.data.width = rightNode.position.x + rightNode.width! + PADDING_X
                n.width = rightNode.position.x + rightNode.width! + PADDING_X
              }
              if (heightShouldExtend) {
                n.data.height = bottomNode.position.y + bottomNode.height! + PADDING_Y
                n.height = bottomNode.position.y + bottomNode.height! + PADDING_Y
              }
            }
          })
        })

        setNodes(newNodes)
      }
    },
    [store]
  )

  const handleNodeLoopChildDrag = useCallback(
    (node: Node) => {
      const { nodes } = store.getState()

      const restrict: { x?: number; y?: number } = { x: undefined, y: undefined }

      if (node.data.isInLoop) {
        const parentNode = nodes.find((n) => n.id === node.parentId)

        if (parentNode) {
          if (node.position.y < PADDING_Y) restrict.y = PADDING_Y
          if (node.position.x < PADDING_X) restrict.x = PADDING_X
          if (node.position.x + node.width! > parentNode!.width! - PADDING_X)
            restrict.x = parentNode!.width! - PADDING_X - node.width!
          if (node.position.y + node.height! > parentNode!.height! - PADDING_Y)
            restrict.y = parentNode!.height! - PADDING_Y - node.height!
        }
      }

      return { restrict }
    },
    [store]
  )

  return { handleNodeLoopRerender, handleNodeLoopChildDrag }
}
