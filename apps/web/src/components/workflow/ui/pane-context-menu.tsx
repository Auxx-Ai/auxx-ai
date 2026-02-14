// apps/web/src/components/workflow/ui/pane-context-menu.tsx

'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { useReactFlow } from '@xyflow/react'
import { Clipboard, Play, Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import {
  useNodeAddition,
  useNodesInteractions,
  useNonTriggerDefinitions,
  useReadOnly,
} from '../hooks'
import { useContextMenu } from '../hooks/use-context-menu'
import { usePanelStore } from '../store/panel-store'
import { useWorkflowStore } from '../store/workflow-store'
import { NodeType } from '../types/node-types'
import { BlockSelector } from './block-selector'

/**
 * Pane context menu - single instance for right-clicking empty canvas
 * Positioned via an invisible trigger at the right-click location
 */
export const PaneContextMenu = memo(() => {
  const reactFlow = useReactFlow()

  // Store selectors
  const paneMenu = useWorkflowStore((state) => state.paneMenu)
  const clipboardElements = useWorkflowStore((state) => state.clipboardElements)

  // Hooks
  const { handlePaneContextMenuClose } = useContextMenu()
  const { handleNodesPaste } = useNodesInteractions()
  const { isReadOnly } = useReadOnly()
  const nonTriggerDefinitions = useNonTriggerDefinitions()
  const { addNode } = useNodeAddition()

  // Filter available node types (exclude triggers since we're adding to canvas)
  const availableNodeTypes = useMemo(() => {
    return nonTriggerDefinitions.filter((def) => def.id !== NodeType.END).map((def) => def.id)
  }, [nonTriggerDefinitions])

  // Check if clipboard has items
  const hasClipboardItems = clipboardElements && clipboardElements.length > 0

  // Don't render if no menu or in read-only mode
  if (!paneMenu || isReadOnly) {
    return null
  }

  /**
   * Convert container-relative position to flow coordinates for node placement
   */
  const getFlowPosition = () => {
    if (!paneMenu) return { x: 0, y: 0 }

    // Get the canvas container
    const container = document.querySelector('.workflow-canvas')
    if (!container) return { x: 0, y: 0 }

    const rect = container.getBoundingClientRect()

    // Convert to screen coordinates
    const screenX = rect.left + paneMenu.left
    const screenY = rect.top + paneMenu.top

    // Use ReactFlow's screenToFlowPosition
    return reactFlow.screenToFlowPosition({ x: screenX, y: screenY })
  }

  /**
   * Handle adding a new block at the click position
   */
  const handleBlockSelect = async (nodeType: string, config?: any) => {
    try {
      const flowPosition = getFlowPosition()

      await addNode({
        nodeType,
        position: flowPosition,
        config,
      })
      handlePaneContextMenuClose()
    } catch (error) {
      console.error('Failed to add node:', error)
    }
  }

  /**
   * Handle paste at click position
   */
  const handlePaste = () => {
    if (!paneMenu) return

    // Get canvas container for screen position calculation
    const container = document.querySelector('.workflow-canvas')
    if (!container) return

    const rect = container.getBoundingClientRect()
    const screenX = rect.left + paneMenu.left
    const screenY = rect.top + paneMenu.top

    handleNodesPaste({ x: screenX, y: screenY })
    handlePaneContextMenuClose()
  }

  /**
   * Handle test run - opens run panel with input tab
   */
  const handleTestRun = () => {
    usePanelStore.getState().openRunPanel()
    usePanelStore.getState().setRunPanelTab('input')
    handlePaneContextMenuClose()
  }

  return (
    <DropdownMenu open={!!paneMenu} onOpenChange={(open) => !open && handlePaneContextMenuClose()}>
      {/* Invisible trigger positioned at click location */}
      <DropdownMenuTrigger asChild>
        <div
          className='absolute w-0 h-0 pointer-events-none'
          style={{
            left: paneMenu?.left ?? 0,
            top: paneMenu?.top ?? 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {/* Add Block - submenu with BlockSelector */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Plus />
            Add Block
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='p-0'>
            <BlockSelector
              inline={true}
              open={true}
              onOpenChange={() => {}}
              onSelect={handleBlockSelect}
              availableBlocksTypes={availableNodeTypes}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Paste - only show if clipboard has items */}
        {hasClipboardItems && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handlePaste}>
              <Clipboard />
              Paste
              <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}

        {/* Test Run */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleTestRun}>
          <Play />
          Test Run
          <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

PaneContextMenu.displayName = 'PaneContextMenu'
