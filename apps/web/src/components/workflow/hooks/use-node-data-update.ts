// apps/web/src/components/workflow/hooks/use-node-data-update.ts

import { getByPath } from '@auxx/utils'
import { deepEqual } from '@auxx/utils/objects'
import { useStore as useReactFlowStore, useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useReadOnly } from './use-read-only'
// import { useWorkflowStore } from '../store/workflow-store'
import { useWorkflowHistory, WorkflowHistoryEvent } from './use-save-to-history'
import { useWorkflowSave } from './use-workflow-save'

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
   * Update node data in the React Flow store, with no side effects.
   *
   * **A write that changes nothing does nothing** and returns `false`. That
   * guard is load-bearing, not an optimisation: `node.data`'s object identity
   * is what drives the canvas re-render, the app-panel iframe push
   * (`apps/.../app-workflow-panel.tsx` sends `update-panel-data-` on every
   * `nodeData` identity change), the autosave and the undo entry. Minting a new
   * identity for an identical value therefore starts a cycle rather than
   * recording an edit — see `plans/kopilot/workflow/29-app-panel-write-loop.md`.
   *
   * The comparison is on the MERGED result, never on the patch: a patch that
   * repeats the values already in `data` is exactly the case being caught.
   *
   * @returns whether anything actually changed
   */
  const handleNodeDataUpdate = useCallback(
    ({ id, data }: NodeDataUpdatePayload): boolean => {
      const { nodes, setNodes } = store.getState()
      const current = nodes.find((node) => node.id === id)
      if (!current) return false

      const merged = { ...current.data, ...data }
      if (deepEqual(merged, current.data)) return false

      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === id)
        if (currentNode) {
          currentNode.data = merged
        }
      })
      setNodes(newNodes)
      return true
    },
    [store]
  )

  /**
   * Updates node data with automatic save and history tracking.
   *
   * Both side effects hang off {@link handleNodeDataUpdate}'s answer, so a
   * no-op write queues no save and records no undo entry. The history half
   * matters more than it looks: `HistoryManager`'s coalesce window is 500 ms,
   * so a repeating writer slower than that gets a NEW entry every time, wipes
   * the redo stack on each one, and evicts the user's real edits once the
   * 50-entry stack overflows.
   */
  const handleNodeDataUpdateWithSync = useCallback(
    (payload: NodeDataUpdatePayload) => {
      if (isReadOnly) return
      if (!handleNodeDataUpdate(payload)) return
      // Variables are automatically synced by VarStoreSyncProvider
      debouncedSave()
      // Keyed per node: a burst of keystrokes in one panel is one undo step,
      // and an edit to a DIFFERENT node starts a new one. Per-field would be
      // finer, but `setInputs` hands over a whole data object, so which field
      // moved is not knowable here.
      saveStateToHistory(WorkflowHistoryEvent.NodeChange, {
        nodeId: payload.id,
        coalesceKey: `NodeChange:${payload.id}`,
      })
    },
    [debouncedSave, handleNodeDataUpdate, isReadOnly, saveStateToHistory]
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
