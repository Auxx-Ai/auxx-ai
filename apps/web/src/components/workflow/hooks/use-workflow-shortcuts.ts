// apps/web/src/components/workflow/hooks/use-workflow-shortcuts.ts

import { useHotkey } from '@tanstack/react-hotkeys'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import React from 'react'
import { useCanvasStore } from '../store/canvas-store'
import { useInteractionStore } from '../store/interaction-store'
import { usePanelStore } from '../store/panel-store'
import { useHistoryManager } from '../store/workflow-store-provider'
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
  const { fitView: rfFitView, zoomIn: rfZoomIn, zoomOut: rfZoomOut } = useReactFlow()
  const store = useStoreApi()
  const { getNodesReadOnly } = useNodesReadOnly()

  // Interaction stores
  const setInteractionMode = useInteractionStore((state) => state.setMode)
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

  // === WORKFLOW OPERATIONS ===

  // Save: Mod+S (fires in inputs too via smart default for Mod+ combos)
  useHotkey('Mod+S', () => save())

  // Test: Mod+Enter
  useHotkey('Mod+Enter', () => {
    openRunPanel()
    setRunPanelTab('input')
  })

  // === HISTORY OPERATIONS ===

  // Undo: Mod+Z
  useHotkey('Mod+Z', () => historyManager.undo())

  // Redo: Mod+Shift+Z or Mod+Y
  useHotkey('Mod+Shift+Z', () => historyManager.redo())
  useHotkey('Mod+Y', () => historyManager.redo())

  // === SELECTION OPERATIONS ===

  // Select All: Mod+A — allow native select-all in text elements
  useHotkey('Mod+A', (event) => {
    const target = event.target as HTMLElement
    const isTextElement =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true' ||
      target.getAttribute('role') === 'textbox' ||
      target.closest('[contenteditable="true"]') !== null
    if (isTextElement) return
    handleSelectAll(true)
  })

  // === NODE OPERATIONS ===

  // Copy: Mod+C — allow native copy when text is selected
  useHotkey(
    'Mod+C',
    () => {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && selection.toString().trim().length > 0) return
      const selectedNodes = getSelectedNodeIds()
      if (selectedNodes.length > 0) {
        handleCopyNode()
      }
    },
    { preventDefault: false }
  )

  // Paste: Mod+V
  useHotkey('Mod+V', () => handleNodesPaste())

  // Duplicate: Mod+D (currently no-op)
  useHotkey('Mod+D', () => {
    const nodesToDuplicate = getSelectedNodeIds()
    if (nodesToDuplicate.length > 0) {
      // duplicateNodes(nodesToDuplicate)
    }
  })

  // Delete: Delete or Backspace
  useHotkey('Delete', () => handleDelete())
  useHotkey('Backspace', () => handleDelete())

  function handleDelete() {
    if (getNodesReadOnly()) return
    const nodesToDelete = getSelectedNodeIds()
    console.log('DELETING NODES nodes/edges', nodesToDelete)
    nodesToDelete.forEach((nodeId) => {
      handleDeleteNode(nodeId)
    })
    const edgesToDelete = getSelectedEdgeIds()
    if (edgesToDelete.length > 0) {
      handleBulkEdgeDelete(edgesToDelete)
    }
  }

  // === ZOOM OPERATIONS ===

  // Zoom In: Mod+= / Mod++
  useHotkey('Mod+=', () => rfZoomIn())
  useHotkey('Mod++', () => rfZoomIn())

  // Zoom Out: Mod+-
  useHotkey('Mod+-', () => rfZoomOut())

  // Fit View: Mod+0
  useHotkey('Mod+0', () => rfFitView())

  // === PANEL OPERATIONS ===

  // Toggle Left Sidebar: Mod+B
  useHotkey('Mod+B', () => toggleLeftSidebar())

  // Toggle Properties Panel: Mod+P
  useHotkey('Mod+P', () => {
    if (activePanel === 'properties') {
      closePanel()
    } else {
      openPanel('properties')
    }
  })

  // Toggle Version History: Mod+Shift+H
  useHotkey('Mod+Shift+H', () => toggleVersions())

  // === INTERACTION MODE SHORTCUTS (single keys — ignored in inputs by smart default) ===

  // Pointer Mode: V
  useHotkey('V', () => {
    if (!isTemporaryPan) {
      setInteractionMode('pointer')
    }
  })

  // Pan Mode: H
  useHotkey('H', () => setInteractionMode('pan'))

  // Temporary Pan Mode: Space (hold to pan, release to stop)
  useHotkey('Space', () => startTemporaryPan())
  useHotkey('Space', () => endTemporaryPan(), { eventType: 'keyup' })

  // Add Node/Block: N
  useHotkey('N', () => toggleBlockSelector())

  // Fit View: F (also available as Mod+0 above)
  useHotkey('F', () => rfFitView())

  // === LAYOUT OPERATIONS ===

  // Auto Layout: Shift+A
  useHotkey('Shift+A', () => {
    if (canOrganize) {
      handleLayout()
    }
  })

  // === DISABLE/ENABLE OPERATIONS ===

  // Toggle Disable: D
  useHotkey('D', () => handleNodeDisable())

  // Toggle Collapse: K
  useHotkey('K', () => handleToggleCollapse())
}
