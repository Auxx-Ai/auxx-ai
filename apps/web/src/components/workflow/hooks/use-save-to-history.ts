// apps/web/src/components/workflow/hooks/use-save-to-history.ts

import { useStoreApi } from '@xyflow/react'
import { useCallback, useState } from 'react'
import type { RecordOptions } from '../store/history-manager'
import { useHistoryManager } from '../store/workflow-store-provider'
import type { FlowEdge, FlowNode } from '../types'
import { snapshotGraph } from '../utils/history-snapshot'

/**
 * The canvas actions that create a new history state.
 *
 * Every member here must be dispatched somewhere and must have a label — the
 * enum, the call sites and {@link getHistoryLabel} are pinned to each other by
 * `__tests__/workflow-history-events.test.ts`, because for a long time they
 * were not: seven of seventeen members named actions nothing ever recorded, and
 * two of those seven (node drag, auto-layout) were user-visible holes in undo.
 *
 * Not every React Flow event belongs here. Pure UI state — selection, viewport,
 * measurement — is deliberately absent: the user does not want Cmd+Z to undo a
 * click.
 */
export enum WorkflowHistoryEvent {
  NodeAdd = 'NodeAdd',
  NodeChange = 'NodeChange',
  NodeDelete = 'NodeDelete',
  NodePaste = 'NodePaste',
  NodeDragStop = 'NodeDragStop',
  NodeResize = 'NodeResize',
  NodeCollapse = 'NodeCollapse',
  EdgeAdd = 'EdgeAdd',
  EdgeDelete = 'EdgeDelete',
  EdgeDeleteByDeleteBranch = 'EdgeDeleteByDeleteBranch',
  LayoutOrganize = 'LayoutOrganize',
}

/**
 * The popover's wording for an event.
 *
 * Deliberately coarse. A label family per node *type* (the old `Note*` members)
 * costs one special case per verb and changes nothing about what is undoable,
 * and a per-*field* label is not derivable at all: `useNodeCrud.setInputs`
 * hands the update path a whole data object, so a title edit and a duration
 * edit are indistinguishable by the time they get here.
 */
export function getHistoryLabel(event: WorkflowHistoryEvent): string {
  switch (event) {
    case WorkflowHistoryEvent.NodeAdd:
      return 'Node added'
    case WorkflowHistoryEvent.NodeChange:
      return 'Node changed'
    case WorkflowHistoryEvent.NodeDelete:
      return 'Node deleted'
    case WorkflowHistoryEvent.NodePaste:
      return 'Node pasted'
    case WorkflowHistoryEvent.NodeDragStop:
      return 'Node position changed'
    case WorkflowHistoryEvent.NodeResize:
      return 'Node resized'
    case WorkflowHistoryEvent.NodeCollapse:
      return 'Node collapsed'
    case WorkflowHistoryEvent.EdgeAdd:
      return 'Edge added'
    case WorkflowHistoryEvent.EdgeDelete:
    case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
      return 'Edge deleted'
    case WorkflowHistoryEvent.LayoutOrganize:
      return 'Layout organized'
  }
}

/**
 * Hook for saving workflow state to history with undo/redo support
 */
export const useWorkflowHistory = () => {
  const store = useStoreApi<FlowNode, FlowEdge>()
  const historyManager = useHistoryManager()

  const [undoCallbacks, setUndoCallbacks] = useState<any[]>([])
  const [redoCallbacks, setRedoCallbacks] = useState<any[]>([])

  const onUndo = useCallback((callback: unknown) => {
    setUndoCallbacks((prev: any) => [...prev, callback])
    return () => setUndoCallbacks((prev) => prev.filter((cb) => cb !== callback))
  }, [])

  const onRedo = useCallback((callback: unknown) => {
    setRedoCallbacks((prev: any) => [...prev, callback])
    return () => setRedoCallbacks((prev) => prev.filter((cb) => cb !== callback))
  }, [])

  // `historyManager.undo()` / `.redo()` emit `history:changed` themselves, so
  // there is nothing to re-emit here.
  const undo = useCallback(() => {
    historyManager.undo()
    undoCallbacks.forEach((callback) => callback())
  }, [undoCallbacks, historyManager])

  const redo = useCallback(() => {
    historyManager.redo()
    redoCallbacks.forEach((callback) => callback())
  }, [redoCallbacks, historyManager])

  /**
   * Record one canvas action.
   *
   * Written immediately — there is no debounce in front of this, so the undo
   * buttons and the history popover are correct the instant the edit lands.
   * High-frequency callers (panel typing, resize) pass a `coalesceKey` so their
   * burst collapses into a single entry; see `HistoryManager.record`.
   */
  const saveStateToHistory = useCallback(
    (event: WorkflowHistoryEvent, options?: RecordOptions) => {
      const { nodes, edges } = store.getState()

      historyManager.record(
        {
          action: 'workflow_event',
          store: 'workflow',
          data: snapshotGraph(event, nodes, edges),
          label: getHistoryLabel(event),
        },
        options
      )
    },
    [store, historyManager]
  )

  // Save initial state to history
  const saveInitialState = useCallback(() => {
    const { nodes, edges } = store.getState()

    // Only save if there's actual content
    if (nodes.length > 0 || edges.length > 0) {
      historyManager.record({
        action: 'workflow_event',
        store: 'workflow',
        data: snapshotGraph('initial', nodes, edges),
        label: 'Initial state',
      })
    }
  }, [store, historyManager])

  return {
    store: historyManager,
    saveStateToHistory,
    getHistoryLabel,
    undo,
    redo,
    onUndo,
    onRedo,
    saveInitialState,
  }
}
