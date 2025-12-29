// apps/web/src/components/workflow/hooks/use-edge-interactions.ts

import { useCallback } from 'react'
import { useStoreApi, applyEdgeChanges, type EdgeChange } from '@xyflow/react'
import { produce } from 'immer'
import { useNodesReadOnly } from '~/components/workflow/hooks'
import { useWorkflowSave } from './use-workflow-save'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-save-to-history'
import { getNodesConnectedSourceOrTargetHandleIdsMap } from '../utils'
import type { Node, Edge } from '@xyflow/react'
// Variable syncing now handled automatically by VarStoreSyncProvider
import type { FlowNode } from '../store/types'

interface InsertNodeParams {
  nodeType: string
  toolDefaultValue?: any
}

interface ConnectionParams {
  prevNodeId: string
  prevNodeSourceHandle: string
  nextNodeId: string
  nextNodeTargetHandle: string
}

// Type for edge mouse event handlers
type EdgeMouseHandler = (event: React.MouseEvent, edge: any) => void

export const useEdgeInteractions = () => {
  const store = useStoreApi()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { debouncedSave } = useWorkflowSave()
  const { saveStateToHistory } = useWorkflowHistory()

  const handleEdgeEnter = useCallback<EdgeMouseHandler>(
    (_, edge) => {
      // Check if in readOnly mode, if so return
      if (getNodesReadOnly()) return

      const { edges, setEdges } = store.getState()
      const newEdges = produce(edges, (draft) => {
        const currentEdge = draft.find((e) => e.id === edge.id)
        if (currentEdge) {
          currentEdge.data = currentEdge.data || {}
          currentEdge.data._hovering = true
        }
      })
      setEdges(newEdges)
    },
    [store, getNodesReadOnly]
  )

  const handleEdgeLeave = useCallback<EdgeMouseHandler>(
    (_, edge) => {
      // Check if in readOnly mode, if so return
      if (getNodesReadOnly()) return

      const { edges, setEdges } = store.getState()
      const newEdges = produce(edges, (draft) => {
        const currentEdge = draft.find((e) => e.id === edge.id)
        if (currentEdge) {
          currentEdge.data = currentEdge.data || {}
          currentEdge.data._hovering = false
        }
      })
      setEdges(newEdges)
    },
    [store, getNodesReadOnly]
  )

  // Helper function to get nodes connected by edges that will be deleted
  const getNodesConnectedSourceOrTargetHandleIdsMap = useCallback(
    (edgeWillBeDeleted: Edge[], nodes: Node[]): Record<string, any> => {
      const nodesConnectedMap: Record<string, any> = {}

      edgeWillBeDeleted.forEach((edge) => {
        // Track target nodes that will lose their connection
        const targetNode = nodes.find((n) => n.id === edge.target)
        if (targetNode) {
          if (!nodesConnectedMap[targetNode.id]) {
            nodesConnectedMap[targetNode.id] = {
              _connectedSourceHandleIds: targetNode.data._connectedSourceHandleIds || [],
              _connectedTargetHandleIds: targetNode.data._connectedTargetHandleIds || [],
            }
          }
          // Remove this source from the target's connected sources
          nodesConnectedMap[targetNode.id]._connectedSourceHandleIds = nodesConnectedMap[
            targetNode.id
          ]._connectedSourceHandleIds.filter(
            (id: string) => !(id === edge.sourceHandle && edge.source === edge.source)
          )
        }
      })

      return nodesConnectedMap
    },
    []
  )

  const handleEdgeDeleteByDeleteBranch = useCallback(
    (nodeId: string, branchId: string) => {
      if (getNodesReadOnly()) return

      const { nodes, setNodes, edges, setEdges } = store.getState()

      // Find edges that will be deleted
      const edgeWillBeDeleted = edges.filter(
        (edge) => edge.source === nodeId && edge.sourceHandle === branchId
      )

      if (!edgeWillBeDeleted.length) return

      // const nodes = getNodes()

      // Get map of nodes that need to be updated
      const nodesConnectedSourceOrTargetHandleIdsMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        edgeWillBeDeleted,
        nodes
      )

      // Update nodes to remove connection references
      const newNodes = produce(nodes, (draft: Node[]) => {
        draft.forEach((node) => {
          if (nodesConnectedSourceOrTargetHandleIdsMap[node.id]) {
            node.data = { ...node.data, ...nodesConnectedSourceOrTargetHandleIdsMap[node.id] }
          }
        })
      })

      setNodes(newNodes)

      // Remove the edges
      const newEdges = produce(edges, (draft) => {
        return draft.filter((edge) => !edgeWillBeDeleted.find((e) => e.id === edge.id))
      })
      setEdges(newEdges)

      // Sync variables for affected target nodes
      const affectedTargetNodes = new Set<string>()
      edgeWillBeDeleted.forEach((edge) => {
        affectedTargetNodes.add(edge.target)
      })

      affectedTargetNodes.forEach((nodeId) => {
        // Variables are automatically synced by VarStoreSyncProvider
      })

      // Sync and save history
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.EdgeDeleteByDeleteBranch)
    },
    [
      getNodesReadOnly,
      getNodesConnectedSourceOrTargetHandleIdsMap,
      store,
      debouncedSave,
      saveStateToHistory,
    ]
  )

  // Handle single edge deletion
  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      if (getNodesReadOnly()) return

      const { edges, setEdges, nodes, setNodes } = store.getState()

      // Find the edge to delete
      const edgeToDelete = edges.find((e) => e.id === edgeId)
      if (!edgeToDelete) return

      // Remove edge from state
      const newEdges = edges.filter((e) => e.id !== edgeId)
      setEdges(newEdges)

      // Update connected nodes metadata
      const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        [{ type: 'remove', edge: edgeToDelete }],
        nodes
      )

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (nodesConnectedMap[node.id]) {
            node.data = { ...node.data, ...nodesConnectedMap[node.id] }
          }
        })
      })
      setNodes(newNodes)

      // Target node variables are automatically synced by VarStoreSyncProvider

      // Sync and save
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
    },
    [
      store,
      getNodesReadOnly,
      debouncedSave,
      saveStateToHistory,
      getNodesConnectedSourceOrTargetHandleIdsMap,
    ]
  )

  // Handle bulk edge deletion
  const handleBulkEdgeDelete = useCallback(
    (edgeIds: string[]) => {
      if (getNodesReadOnly()) return
      if (edgeIds.length === 0) return

      const { edges, setEdges, nodes, setNodes } = store.getState()

      // Find edges to delete
      const edgesToDelete = edges.filter((e) => edgeIds.includes(e.id))
      if (edgesToDelete.length === 0) return

      // Remove edges
      const newEdges = edges.filter((e) => !edgeIds.includes(e.id))
      setEdges(newEdges)

      // Update all affected nodes
      const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
        edgesToDelete.map((edge) => ({ type: 'remove', edge })),
        nodes
      )

      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          if (nodesConnectedMap[node.id]) {
            node.data = { ...node.data, ...nodesConnectedMap[node.id] }
          }
        })
      })
      setNodes(newNodes)

      // Sync variables for all affected target nodes
      const affectedTargetNodes = new Set<string>()
      edgesToDelete.forEach((edge) => {
        affectedTargetNodes.add(edge.target)
      })

      affectedTargetNodes.forEach((nodeId) => {
        // Variables are automatically synced by VarStoreSyncProvider
      })

      // Sync and save
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
    },
    [
      store,
      getNodesReadOnly,
      debouncedSave,
      saveStateToHistory,
      getNodesConnectedSourceOrTargetHandleIdsMap,
    ]
  )

  // Handle edge changes from ReactFlow
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (getNodesReadOnly()) return

      const { edges, setEdges, nodes, setNodes } = store.getState()
      // Apply changes using ReactFlow's helper
      const newEdges = applyEdgeChanges(changes, edges)
      setEdges(newEdges)

      // Handle deletions to update node metadata
      const deleteChanges = changes.filter((c) => c.type === 'remove')
      if (deleteChanges.length > 0) {
        // Get edges that are being deleted
        const deletedEdgeIds = deleteChanges.map((c) => c.id)
        const deletedEdges = edges.filter((e) => deletedEdgeIds.includes(e.id))

        if (deletedEdges.length > 0) {
          // Update node connection metadata
          const nodesConnectedMap = getNodesConnectedSourceOrTargetHandleIdsMap(
            deletedEdges.map((edge) => ({ type: 'remove', edge })),
            nodes
          )

          const newNodes = produce(nodes, (draft) => {
            draft.forEach((node) => {
              if (nodesConnectedMap[node.id]) {
                node.data = { ...node.data, ...nodesConnectedMap[node.id] }
              }
            })
          })
          setNodes(newNodes)

          // Sync variables for affected target nodes
          const affectedTargetNodes = new Set<string>()
          deletedEdges.forEach((edge) => {
            affectedTargetNodes.add(edge.target)
          })

          // Variables are automatically synced by VarStoreSyncProvider

          // Trigger save
          debouncedSave()
          saveStateToHistory(WorkflowHistoryEvent.EdgeDelete)
        }
      }
    },
    [
      store,
      getNodesReadOnly,
      debouncedSave,
      saveStateToHistory,
      getNodesConnectedSourceOrTargetHandleIdsMap,
    ]
  )

  return {
    handleEdgeEnter,
    handleEdgeLeave,
    handleEdgeDelete,
    handleBulkEdgeDelete,
    handleEdgeDeleteByDeleteBranch,
    handleEdgesChange,
  }
}
