import type { MouseEvent } from 'react'
import { useCallback } from 'react'
import { produce } from 'immer'
import type { OnSelectionChangeFunc, Node } from '@xyflow/react'
import { useStoreApi } from '@xyflow/react'
// import { useWorkflowStore } from '../store'
import { storeEventBus } from '../store/event-bus'

export const useSelectionInteractions = () => {
  const store = useStoreApi()
  // const workflowStore = useWorkflowStore()

  const handleSelectionStart = useCallback(() => {
    const { nodes, setNodes, edges, setEdges, userSelectionRect } = store.getState()
    if (!userSelectionRect?.width || !userSelectionRect?.height) {
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (node.data._isBundled) node.data._isBundled = false
        })
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          if (edge.data?._isBundled) edge.data._isBundled = false
        })
      })
      setEdges(newEdges)
    }
  }, [store])

  const handleSelectionChange = useCallback<OnSelectionChangeFunc>(
    ({ nodes: nodesInSelection, edges: edgesInSelection }) => {
      const { nodes, setNodes, edges, setEdges, userSelectionRect } = store.getState()

      // When selection is complete (no active selection rect)
      if (!userSelectionRect?.width || !userSelectionRect?.height) {
        // Only emit if we actually have a selection
        if (nodesInSelection.length > 0 || edgesInSelection.length > 0) {
          const selectedNodeIds = nodesInSelection.map((n) => n.id)
          const selectedEdgeIds = edgesInSelection.map((e) => e.id)

          storeEventBus.emit({
            type: 'selection:changed',
            data: { nodes: selectedNodeIds, edges: selectedEdgeIds },
          })
        }
        return
      }

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          const nodeInSelection = nodesInSelection.find((n) => n.id === node.id)

          if (nodeInSelection) {
            node.data._isBundled = true
            node.selected = true // Ensure node is marked as selected
          } else {
            node.data._isBundled = false
            node.selected = false // Ensure node is marked as not selected
          }
        })
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          const edgeInSelection = edgesInSelection.find((e) => e.id === edge.id)

          if (edgeInSelection) edge.data._isBundled = true
          else edge.data._isBundled = false
        })
      })
      setEdges(newEdges)
    },
    [store]
  )

  const handleSelectionDrag = useCallback(
    (_: MouseEvent, nodesWithDrag: Node[]) => {
      const { nodes, setNodes } = store.getState()

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          const dragNode = nodesWithDrag.find((n) => n.id === node.id)

          if (dragNode) node.position = dragNode.position
        })
      })
      setNodes(newNodes)
    },
    [store]
  )

  const handleSelectionCancel = useCallback(() => {
    const { nodes, setNodes, edges, setEdges } = store.getState()
    store.setState({ userSelectionRect: null, userSelectionActive: true })

    // const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.data._isBundled) node.data._isBundled = false
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        if (edge.data._isBundled) edge.data._isBundled = false
      })
    })
    setEdges(newEdges)
  }, [store])

  return { handleSelectionStart, handleSelectionChange, handleSelectionDrag, handleSelectionCancel }
}
