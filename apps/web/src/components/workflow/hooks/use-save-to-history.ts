// apps/web/src/components/workflow/hooks/use-save-to-history.ts

import { debounce } from '@auxx/utils'
import { useStoreApi } from '@xyflow/react'
import { useCallback, useRef, useState } from 'react'
import { storeEventBus } from '../store/event-bus'
import { useHistoryManager } from '../store/workflow-store-provider'

/**
 * All supported Events that create a new history state.
 * Current limitations:
 * - InputChange events in Node Panels do not trigger state changes.
 * - Resizing UI elements does not trigger state changes.
 */
export enum WorkflowHistoryEvent {
  NodeTitleChange = 'NodeTitleChange',
  NodeDescriptionChange = 'NodeDescriptionChange',
  NodeDragStop = 'NodeDragStop',
  NodeChange = 'NodeChange',
  NodeConnect = 'NodeConnect',
  NodePaste = 'NodePaste',
  NodeDelete = 'NodeDelete',
  EdgeAdd = 'EdgeAdd',
  EdgeDelete = 'EdgeDelete',
  EdgeDeleteByDeleteBranch = 'EdgeDeleteByDeleteBranch',
  NodeAdd = 'NodeAdd',
  NodeResize = 'NodeResize',
  NodeCollapse = 'NodeCollapse',
  NoteAdd = 'NoteAdd',
  NoteChange = 'NoteChange',
  NoteDelete = 'NoteDelete',
  LayoutOrganize = 'LayoutOrganize',
}

/**
 * Hook for saving workflow state to history with undo/redo support
 */
export const useWorkflowHistory = () => {
  const store = useStoreApi()
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

  const undo = useCallback(() => {
    historyManager.undo()
    undoCallbacks.forEach((callback) => callback())

    // Emit event for UI updates
    storeEventBus.emit({
      type: 'history:changed' as any,
      data: { canUndo: historyManager.canUndo(), canRedo: historyManager.canRedo() },
    })
  }, [undoCallbacks, historyManager])

  const redo = useCallback(() => {
    historyManager.redo()
    redoCallbacks.forEach((callback) => callback())

    // Emit event for UI updates
    storeEventBus.emit({
      type: 'history:changed' as any,
      data: { canUndo: historyManager.canUndo(), canRedo: historyManager.canRedo() },
    })
  }, [redoCallbacks, historyManager])

  // Some events may be triggered multiple times in a short period of time.
  // We debounce the history state update to avoid creating multiple history states
  // with minimal changes. Increased to 2 seconds for better performance.
  const saveStateToHistoryRef = useRef(
    debounce((event: WorkflowHistoryEvent) => {
      // For workflow-level events, we record a synthetic history entry
      // The actual state changes are already recorded by the stores
      const { nodes, edges } = store.getState()

      historyManager.record({
        action: 'workflow_event',
        store: 'workflow',
        data: {
          event,
          // Save complete node data for proper restoration
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: { ...n.position },
            data: n.data ? { ...n.data } : undefined,
            width: n.width,
            height: n.height,
            selected: n.selected,
            sourcePosition: n.sourcePosition,
            targetPosition: n.targetPosition,
            dragging: false, // Reset dragging state
            style: n.style,
            className: n.className,
            parentId: n.parentId,
            zIndex: n.zIndex,
            extent: n.extent,
            expandParent: n.expandParent,
            draggable: n.draggable,
            selectable: n.selectable,
            connectable: n.connectable,
            deletable: n.deletable,
            focusable: n.focusable,
            hidden: n.hidden,
          })),
          // Save complete edge data
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            sourceHandle: e.sourceHandle,
            target: e.target,
            targetHandle: e.targetHandle,
            type: e.type,
            data: e.data ? { ...e.data } : undefined,
            selected: e.selected,
            animated: e.animated,
            hidden: e.hidden,
            deletable: e.deletable,
            focusable: e.focusable,
            selectable: e.selectable,
            markerStart: e.markerStart,
            markerEnd: e.markerEnd,
            zIndex: e.zIndex,
            ariaLabel: e.ariaLabel,
            interactionWidth: e.interactionWidth,
            className: e.className,
            style: e.style,
          })),
        },
        label: getHistoryLabel(event),
      })
    }, 2000)
  )

  const saveStateToHistory = useCallback((event: WorkflowHistoryEvent) => {
    switch (event) {
      case WorkflowHistoryEvent.NoteChange:
        // Hint: Note change does not trigger when note text changes,
        // because the note editors have their own history states.
        saveStateToHistoryRef.current(event)
        break
      case WorkflowHistoryEvent.NodeTitleChange:
      case WorkflowHistoryEvent.NodeDescriptionChange:
      case WorkflowHistoryEvent.NodeDragStop:
      case WorkflowHistoryEvent.NodeChange:
      case WorkflowHistoryEvent.NodeConnect:
      case WorkflowHistoryEvent.NodePaste:
      case WorkflowHistoryEvent.NodeDelete:
      case WorkflowHistoryEvent.EdgeAdd:
      case WorkflowHistoryEvent.EdgeDelete:
      case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
      case WorkflowHistoryEvent.NodeAdd:
      case WorkflowHistoryEvent.NodeResize:
      case WorkflowHistoryEvent.NodeCollapse:
      case WorkflowHistoryEvent.NoteAdd:
      case WorkflowHistoryEvent.LayoutOrganize:
      case WorkflowHistoryEvent.NoteDelete:
        saveStateToHistoryRef.current(event)
        break
      default:
        // We do not create a history state for every event.
        // Some events of reactflow may change things the user would not want to undo/redo.
        // For example: UI state changes like selecting a node.
        break
    }
  }, [])

  const getHistoryLabel = useCallback((event: WorkflowHistoryEvent) => {
    // TODO: Add proper translation support with react-i18next
    switch (event) {
      case WorkflowHistoryEvent.NodeTitleChange:
        return 'Node title changed'
      case WorkflowHistoryEvent.NodeDescriptionChange:
        return 'Node description changed'
      case WorkflowHistoryEvent.LayoutOrganize:
      case WorkflowHistoryEvent.NodeDragStop:
        return 'Node position changed'
      case WorkflowHistoryEvent.NodeChange:
        return 'Node changed'
      case WorkflowHistoryEvent.NodeConnect:
        return 'Nodes connected'
      case WorkflowHistoryEvent.NodePaste:
        return 'Node pasted'
      case WorkflowHistoryEvent.NodeDelete:
        return 'Node deleted'
      case WorkflowHistoryEvent.NodeAdd:
        return 'Node added'
      case WorkflowHistoryEvent.EdgeAdd:
        return 'Edge added'
      case WorkflowHistoryEvent.EdgeDelete:
      case WorkflowHistoryEvent.EdgeDeleteByDeleteBranch:
        return 'Edge deleted'
      case WorkflowHistoryEvent.NodeResize:
        return 'Node resized'
      case WorkflowHistoryEvent.NodeCollapse:
        return 'Node collapsed'
      case WorkflowHistoryEvent.NoteAdd:
        return 'Note added'
      case WorkflowHistoryEvent.NoteChange:
        return 'Note changed'
      case WorkflowHistoryEvent.NoteDelete:
        return 'Note deleted'
      default:
        return 'Unknown Event'
    }
  }, [])

  // Save initial state to history
  const saveInitialState = useCallback(() => {
    const { nodes, edges } = store.getState()

    // Only save if there's actual content
    if (nodes.length > 0 || edges.length > 0) {
      historyManager.record({
        action: 'workflow_event',
        store: 'workflow',
        data: {
          event: 'initial' as any,
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: { ...n.position },
            data: n.data ? { ...n.data } : undefined,
            width: n.width,
            height: n.height,
            selected: n.selected,
            sourcePosition: n.sourcePosition,
            targetPosition: n.targetPosition,
            dragging: false,
            style: n.style,
            className: n.className,
            parentId: n.parentId,
            zIndex: n.zIndex,
            extent: n.extent,
            expandParent: n.expandParent,
            draggable: n.draggable,
            selectable: n.selectable,
            connectable: n.connectable,
            deletable: n.deletable,
            focusable: n.focusable,
            hidden: n.hidden,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            sourceHandle: e.sourceHandle,
            target: e.target,
            targetHandle: e.targetHandle,
            type: e.type,
            data: e.data ? { ...e.data } : undefined,
            selected: e.selected,
            animated: e.animated,
            hidden: e.hidden,
            deletable: e.deletable,
            focusable: e.focusable,
            selectable: e.selectable,
            markerStart: e.markerStart,
            markerEnd: e.markerEnd,
            zIndex: e.zIndex,
            ariaLabel: e.ariaLabel,
            interactionWidth: e.interactionWidth,
            className: e.className,
            style: e.style,
          })),
        },
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

/**
 * Legacy hook for backward compatibility
 * @deprecated Use useWorkflowHistory instead
 */
export const useSaveToHistory = () => {
  const { saveStateToHistory } = useWorkflowHistory()

  return useCallback(
    (event: string) => {
      // Map string events to enum values or use as-is
      saveStateToHistory(event as WorkflowHistoryEvent)
    },
    [saveStateToHistory]
  )
}
