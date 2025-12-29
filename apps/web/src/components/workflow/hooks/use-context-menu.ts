// apps/web/src/components/workflow/hooks/use-context-menu.ts

import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useWorkflowStore } from '../store/workflow-store'
import { NodeType } from '../types/node-types'

/**
 * Hook for managing workflow context menus
 * Provides handlers for opening/closing node and pane context menus
 */
export const useContextMenu = () => {
  const setNodeMenu = useWorkflowStore((state) => state.setNodeMenu)
  const setPaneMenu = useWorkflowStore((state) => state.setPaneMenu)
  const clearAllMenus = useWorkflowStore((state) => state.clearAllMenus)

  /**
   * Handle right-click on a node
   * Opens the node context menu at the click position
   */
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      // Skip context menu for certain node types
      if (node.data.type === NodeType.NOTE || node.data.type === NodeType.LOOP) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      // Get container-relative coordinates
      const container = document.querySelector('.workflow-canvas')
      if (!container) return

      const { x, y } = container.getBoundingClientRect()

      // Clear pane menu if open
      setPaneMenu(undefined)

      // Set node menu with position and nodeId
      setNodeMenu({
        top: e.clientY - y,
        left: e.clientX - x,
        nodeId: node.id,
      })
    },
    [setNodeMenu, setPaneMenu]
  )

  /**
   * Handle right-click on the pane (empty canvas area)
   * Opens the pane context menu for adding nodes
   */
  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()

      const container = document.querySelector('.workflow-canvas')
      if (!container) return

      const { x, y } = container.getBoundingClientRect()

      // Clear node menu if open
      setNodeMenu(undefined)

      // Set pane menu with position
      setPaneMenu({
        top: e.clientY - y,
        left: e.clientX - x,
      })
    },
    [setNodeMenu, setPaneMenu]
  )

  /**
   * Close the node context menu
   */
  const handleNodeContextMenuClose = useCallback(() => {
    setNodeMenu(undefined)
  }, [setNodeMenu])

  /**
   * Close the pane context menu
   */
  const handlePaneContextMenuClose = useCallback(() => {
    setPaneMenu(undefined)
  }, [setPaneMenu])

  return {
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleNodeContextMenuClose,
    handlePaneContextMenuClose,
    clearAllMenus,
  }
}
