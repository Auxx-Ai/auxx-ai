// apps/web/src/components/workflow/hooks/use-node-data-update.ts
import { useCallback, useMemo } from 'react'
import { produce } from 'immer'
import { useStoreApi, useStore as useReactFlowStore } from '@xyflow/react'
import { getByPath } from '@auxx/utils'
import { useWorkflowSave } from './use-workflow-save'
// import { useWorkflowStore } from '../store/workflow-store'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-save-to-history'
import { useReadOnly } from './use-read-only'
// Variable syncing now handled automatically by VarStoreSyncProvider

type NodeDataUpdatePayload = { id: string; data: Record<string, any> }

/**
 * Core hook for updating node data in ReactFlow
 * Handles synchronization with backend and history tracking
 */
export const useNodeDataUpdate = () => {
  const store = useStoreApi()
  const { debouncedSave } = useWorkflowSave()
  const { saveStateToHistory } = useWorkflowHistory()
  // const readOnly = useWorkflowStore((s) => s.readOnly)
  const { isReadOnly } = useReadOnly()

  /**
   * Updates node data in ReactFlow store without side effects
   */
  const handleNodeDataUpdate = useCallback(
    ({ id, data }: NodeDataUpdatePayload) => {
      const { nodes, setNodes } = store.getState()
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === id)
        if (currentNode) {
          currentNode.data = { ...currentNode.data, ...data }
        }
      })
      setNodes(newNodes)
    },
    [store]
  )

  /**
   * Updates node data with automatic save and history tracking
   */
  const handleNodeDataUpdateWithSync = useCallback(
    (payload: NodeDataUpdatePayload) => {
      if (isReadOnly) return
      handleNodeDataUpdate(payload)
      // Variables are automatically synced by VarStoreSyncProvider
      debouncedSave()
      saveStateToHistory(WorkflowHistoryEvent.NodeChange)
    },
    [debouncedSave, handleNodeDataUpdate, isReadOnly, saveStateToHistory, store]
  )

  return { handleNodeDataUpdate, handleNodeDataUpdateWithSync }
}

/**
 * Simple CRUD hook for node data
 * Provides data and setData for easy state management
 * Works with flattened data structure only
 */
export const useNodeCrud = <TData = any>(id: string, data: TData) => {
  const { handleNodeDataUpdateWithSync } = useNodeDataUpdate()

  const setData = (newData: TData) => {
    handleNodeDataUpdateWithSync({ id, data: newData as any })
  }

  return { inputs: data, setInputs: setData }
}

/**
 * Hook for reading node data from ReactFlow store
 * Provides typed access to node data with path support and subscribes to changes
 */
export const useNodeData = <T = any>(nodeId: string) => {
  // Subscribe to store changes to get live updates
  const node = useReactFlowStore((state) => state.nodes.find((n) => n.id === nodeId))

  const get = (path?: string): any => {
    if (!node?.data) return undefined
    if (!path) return node.data as T
    return getByPath(node.data, path)
  }

  return { node, data: node?.data as T, get }
}
