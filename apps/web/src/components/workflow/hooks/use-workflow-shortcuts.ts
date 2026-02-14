// apps/web/src/components/workflow/hooks/use-workflow-shortcuts.ts

import { useReactFlow, useStoreApi } from '@xyflow/react'
import React from 'react'
import { useCanvasStore } from '../store/canvas-store'
import { useInteractionStore } from '../store/interaction-store'
import { usePanelStore } from '../store/panel-store'
import { useHistoryManager } from '../store/workflow-store-provider'
import { hasActiveTextSelection } from '../utils/keyboard-utils'
import { useEdgeInteractions } from './use-edge-interactions'
import { useNodesInteractions } from './use-node-interactions'
import { useNodesReadOnly } from './use-read-only'
import { useWorkflowOrganize } from './use-workflow-organize'
import { useWorkflowSave } from './use-workflow-save'

/**
 * Centralized hook for handling all keyboard shortcuts in the workflow editor
 */
export function useWorkflowShortcuts() {
  // ReactFlow hooks
  const {
    // getNodes,
    // getEdges,
    fitView: rfFitView,
    zoomIn: rfZoomIn,
    zoomOut: rfZoomOut,
  } = useReactFlow()
  const store = useStoreApi()
  const { getNodesReadOnly } = useNodesReadOnly()

  // Interaction stores
  const setInteractionMode = useInteractionStore((state) => state.setMode)
  const togglePanMode = useInteractionStore((state) => state.togglePanMode)
  const startTemporaryPan = useInteractionStore((state) => state.startTemporaryPan)
  const endTemporaryPan = useInteractionStore((state) => state.endTemporaryPan)
  const isTemporaryPan = useInteractionStore((state) => state.isTemporaryPan)

  // Canvas operations
  const toggleVersions = useCanvasStore((state) => state.toggleVersions)
  const toggleBlockSelector = useCanvasStore((state) => state.toggleBlockSelector)

  // History and workflow
  const historyManager = useHistoryManager()
  const { save } = useWorkflowSave()
  const { handleLayout, canOrganize } = useWorkflowOrganize()

  // Edge interactions
  const { handleBulkEdgeDelete } = useEdgeInteractions()

  // Node interactions (copy/paste/delete)
  const {
    handleCopyNode,
    handleNodesPaste,
    handleDeleteNode,
    handleSelectAll,
    handleNodeDisable,
    handleToggleCollapse,
  } = useNodesInteractions()

  // Node operations (keep these for now)
  // const duplicateNodes = useNodeStore((state) => state.duplicateNodes)
  // const disableNodes = useNodeStore((state) => state.disableNodes)
  // const enableNodes = useNodeStore((state) => state.enableNodes)

  // Selection (keep for now)
  // const selectAll = useSelectionStore((state) => state.selectAll)
  // const deselectAll = useSelectionStore((state) => state.deselectAll)

  // Panel management
  const toggleLeftSidebar = usePanelStore((state) => state.toggleLeftSidebar)
  const openPanel = usePanelStore((state) => state.openPanel)
  const closePanel = usePanelStore((state) => state.closePanel)
  const activePanel = usePanelStore((state) => state.activePanel)
  const openRunPanel = usePanelStore((state) => state.openRunPanel)
  const setRunPanelTab = usePanelStore((state) => state.setRunPanelTab)

  // Get selected nodes and edges from ReactFlow
  const getSelectedNodeIds = React.useCallback(() => {
    const { nodes } = store.getState()
    return nodes.filter((n) => n.selected).map((n) => n.id)
  }, [store])

  const getSelectedEdgeIds = React.useCallback(() => {
    const { edges } = store.getState()
    return edges.filter((e) => e.selected).map((e) => e.id)
  }, [store])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCmd = event.metaKey || event.ctrlKey
      const isShift = event.shiftKey
      if (!event.key) return // Ignore if key is not defined
      const key = event.key.toLowerCase()

      // Prevent shortcuts when typing in inputs
      const target = event.target as HTMLElement
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true' ||
        target.getAttribute('role') === 'textbox'

      if (isInputField) {
        // Only allow save shortcut in inputs
        if (isCmd && key === 's') {
          event.preventDefault()
          save()
        }
        return
      }

      // Handle shortcuts
      switch (true) {
        // === WORKFLOW OPERATIONS ===
        // Save: Cmd/Ctrl + S
        case isCmd && key === 's':
          event.preventDefault()
          save()
          break

        // Test: Cmd/Ctrl + Enter
        case isCmd && key === 'enter':
          event.preventDefault()
          openRunPanel()
          setRunPanelTab('input')
          break

        // === HISTORY OPERATIONS ===
        // Undo: Cmd/Ctrl + Z
        case isCmd && !isShift && key === 'z':
          event.preventDefault()
          historyManager.undo()
          break

        // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
        case isCmd && isShift && key === 'z':
        case isCmd && key === 'y':
          event.preventDefault()
          historyManager.redo()
          break

        // === SELECTION OPERATIONS ===
        // Select All: Cmd/Ctrl + A
        case isCmd && key === 'a': {
          // Check if target is a text element where select all should work natively
          const targetElement = event.target as HTMLElement
          const isTextElement =
            targetElement.tagName === 'INPUT' ||
            targetElement.tagName === 'TEXTAREA' ||
            targetElement.contentEditable === 'true' ||
            targetElement.getAttribute('role') === 'textbox' ||
            // Check if inside any element with text content that might want select all
            targetElement.closest('[contenteditable="true"]') !== null

          // If user is in a text context, allow native select all
          if (isTextElement) {
            return
          }

          // Otherwise, select all workflow nodes
          event.preventDefault()
          handleSelectAll(true)
          break
        }

        // === NODE OPERATIONS ===
        // Copy: Cmd/Ctrl + C
        case isCmd && key === 'c': {
          // If user has text selected, allow native browser copy
          if (hasActiveTextSelection()) {
            // Don't prevent default - let browser handle text copy
            return
          }
          // Otherwise, copy workflow nodes if any are selected
          event.preventDefault()
          const selectedNodes = getSelectedNodeIds()
          if (selectedNodes.length > 0) {
            handleCopyNode() // Will copy all selected nodes
          }
          break
        }

        // Paste: Cmd/Ctrl + V
        case isCmd && key === 'v':
          event.preventDefault()
          handleNodesPaste() // Will paste at default position
          break

        // Duplicate: Cmd/Ctrl + D
        case isCmd && key === 'd': {
          event.preventDefault()
          const nodesToDuplicate = getSelectedNodeIds()
          if (nodesToDuplicate.length > 0) {
            // duplicateNodes(nodesToDuplicate)
          }
          break
        }

        // Delete: Delete or Backspace
        case key === 'delete' || key === 'backspace': {
          event.preventDefault()
          if (getNodesReadOnly()) return

          // Delete selected nodes
          const nodesToDelete = getSelectedNodeIds()
          console.log('DELETING NODES nodes/edges', nodesToDelete)

          nodesToDelete.forEach((nodeId) => {
            handleDeleteNode(nodeId)
          })
          // Delete selected edges
          const edgesToDelete = getSelectedEdgeIds()
          if (edgesToDelete.length > 0) {
            handleBulkEdgeDelete(edgesToDelete)
          }
          // Clear selection using ReactFlow directly instead of deprecated store: fix 2025-12-05
          // const { nodes, edges, setNodes, setEdges } = store.getState()
          // setNodes(nodes.map((node) => ({ ...node, selected: false })))
          // setEdges(edges.map((edge) => ({ ...edge, selected: false })))
          break
        }

        // === ZOOM OPERATIONS ===
        // Zoom In: Cmd/Ctrl + Plus/Equals
        case isCmd && (key === '=' || key === '+'):
          event.preventDefault()
          rfZoomIn()
          break

        // Zoom Out: Cmd/Ctrl + Minus
        case isCmd && key === '-':
          event.preventDefault()
          rfZoomOut()
          break

        // Fit View: Cmd/Ctrl + 0 or F key
        case isCmd && key === '0':
        case key === 'f':
          event.preventDefault()
          rfFitView()
          break

        // === PANEL OPERATIONS ===
        // Toggle Left Sidebar: Cmd/Ctrl + B
        case isCmd && key === 'b':
          event.preventDefault()
          toggleLeftSidebar()
          break

        // Toggle Properties Panel: Cmd/Ctrl + P
        case isCmd && key === 'p':
          event.preventDefault()
          if (activePanel === 'properties') {
            closePanel()
          } else {
            openPanel('properties')
          }
          break

        // Toggle Variables Panel: Cmd/Ctrl + Shift + V
        // case isCmd && isShift && key === 'v':
        //   event.preventDefault()
        //   if (activePanel === 'variables') {
        //     closePanel()
        //   } else {
        //     openPanel('variables')
        //   }
        //   break

        // Toggle Version History: Cmd/Ctrl + Shift + H
        case isCmd && isShift && key === 'h':
          event.preventDefault()
          toggleVersions()
          break

        // === INTERACTION MODE SHORTCUTS ===
        // Pointer Mode: V key
        case key === 'v' && !isCmd:
          event.preventDefault()
          // Only switch to pointer mode if not in temporary pan
          if (!isTemporaryPan) {
            setInteractionMode('pointer')
          }
          break

        // Pan Mode: H key
        case key === 'h':
          event.preventDefault()
          setInteractionMode('pan')
          break

        // Temporary Pan Mode: Space
        case key === ' ':
          event.preventDefault()
          startTemporaryPan()
          break

        // Add Node/Block: N key
        case key === 'n' && !isCmd && !isShift:
          event.preventDefault()
          toggleBlockSelector()
          break

        // === LAYOUT OPERATIONS ===
        // Auto Layout: Shift + A
        case isShift && key === 'a':
          event.preventDefault()
          if (canOrganize) {
            handleLayout()
          }
          break

        // === DISABLE/ENABLE OPERATIONS ===
        // Toggle Disable: D key
        case key === 'd' && !isCmd && !isShift:
          event.preventDefault()
          handleNodeDisable()
          break

        // === COLLAPSE/EXPAND OPERATIONS ===
        // Toggle Collapse: K key
        case key === 'k' && !isCmd && !isShift:
          event.preventDefault()
          handleToggleCollapse()
          break

        default:
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      // Handle space key release to end temporary pan mode
      if (event.key === ' ') {
        const target = event.target as HTMLElement
        const isInputField =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true' ||
          target.getAttribute('role') === 'textbox'

        if (!isInputField) {
          // End temporary pan mode when space is released
          endTemporaryPan()
        }
      }
    }

    // Add event listeners
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    store,
    setInteractionMode,
    togglePanMode,
    startTemporaryPan,
    endTemporaryPan,
    isTemporaryPan,
    rfZoomIn,
    rfZoomOut,
    rfFitView,
    toggleVersions,
    toggleBlockSelector,
    historyManager,
    save,
    handleLayout,
    canOrganize,
    handleCopyNode,
    handleNodesPaste,
    // duplicateNodes,
    handleDeleteNode,
    // disableNodes,
    // enableNodes,
    getSelectedNodeIds,
    getSelectedEdgeIds,
    handleSelectAll,
    // selectAll,
    // deselectAll,
    toggleLeftSidebar,
    openPanel,
    closePanel,
    activePanel,
    openRunPanel,
    setRunPanelTab,
    handleToggleCollapse,
  ])
}
