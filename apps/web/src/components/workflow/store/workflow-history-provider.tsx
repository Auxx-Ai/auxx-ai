// apps/web/src/components/workflow/store/workflow-history-provider.tsx

import { useStoreApi } from '@xyflow/react'
import type React from 'react'
import { useEffect } from 'react'
import { useWorkflowHistory } from '../hooks/use-save-to-history'
import type { FlowNode } from '../types'
import { mergeInteractionState } from '../utils/interaction-state'
import { useWorkflowStore } from './workflow-store'
import { useHistoryManager } from './workflow-store-provider'

interface WorkflowHistoryProviderProps {
  children: React.ReactNode
}

/**
 * Provider component that sets up history management for the workflow
 * This must be used inside both ReactFlowProvider and WorkflowStoreProvider
 */
export const WorkflowHistoryProvider: React.FC<WorkflowHistoryProviderProps> = ({ children }) => {
  const reactFlowStore = useStoreApi()
  const historyManager = useHistoryManager()
  const { onUndo, onRedo, saveInitialState } = useWorkflowHistory()

  // Register ReactFlow store with history manager
  useEffect(() => {
    if (!reactFlowStore) return

    // Create a simple store wrapper for history manager. These setters are
    // ONLY reached by history restores (undo/redo/jumpToState) — they bypass
    // the canvas interaction paths that normally queue a save, so each restore
    // queues one itself. Load-bearing for Kopilot edits: the realtime rehydrate
    // records the edit as a history entry on a CLEAN canvas, and undoing it
    // must leave a saveable canvas rather than one the save path skips.
    //
    // This MUST queue the `graph` key, not just `markDirty()`. Since phase D the
    // pending set is the complete record of what needs writing, and `runSave`
    // treats an empty set as "already up to date" — so a bare `markDirty()`
    // leaves undo unsaved AND makes the explicit Save button report success
    // without writing anything. The content guard still decides whether the
    // request actually goes out.
    const markRestoreDirty = () => {
      const state = useWorkflowStore.getState()
      state.markDirty()
      state.queueSave?.({ graph: true })
    }
    const workflowStore = {
      setNodes: (nodes: any[]) => {
        const { setNodes, nodes: liveNodes } = reactFlowStore.getState()
        // Authored content from the snapshot, interaction state from the live
        // canvas — the same contract `workflow:externalUpdate` and the version
        // popover use. A history restore was the last wholesale replace that
        // skipped it, which cost it twice: the snapshot replayed a persisted
        // `selected` (opening a panel for a node the user was not looking at),
        // and it carried no `measured`, so every restored node rendered at zero
        // size for a frame.
        setNodes(mergeInteractionState(nodes as FlowNode[], liveNodes as FlowNode[]))
        markRestoreDirty()
      },
      setEdges: (edges: any[]) => {
        const { setEdges } = reactFlowStore.getState()
        setEdges(edges)
        markRestoreDirty()
      },
      getState: () => reactFlowStore.getState(),
    }

    // Register with history manager
    historyManager.registerStore('workflow', workflowStore)

    // Set up undo/redo handlers
    const unsubscribeUndo = onUndo(() => {
      // The history manager will handle the state restoration
      // We don't need to do anything here since the history manager
      // has access to the store and will call setNodes/setEdges
    })

    const unsubscribeRedo = onRedo(() => {
      // Same for redo - history manager handles it
    })

    return () => {
      historyManager.unregisterStore('workflow')
      unsubscribeUndo()
      unsubscribeRedo()
    }
  }, [reactFlowStore, historyManager, onUndo, onRedo])

  // Save initial state after a small delay to ensure ReactFlow is ready
  useEffect(() => {
    const timer = setTimeout(() => {
      saveInitialState()
    }, 100)

    return () => clearTimeout(timer)
  }, [saveInitialState])

  return <>{children}</>
}
