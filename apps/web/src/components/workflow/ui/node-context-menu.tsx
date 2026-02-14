// apps/web/src/components/workflow/ui/node-context-menu.tsx

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
import type { Node } from '@xyflow/react'
import { useNodes } from '@xyflow/react'
import {
  Copy,
  FoldVertical,
  Power,
  PowerOff,
  RefreshCw,
  Target,
  Trash2,
  UnfoldVertical,
} from 'lucide-react'
import { memo, useMemo } from 'react'
import {
  useNodeAddition,
  useNodesInteractions,
  useNonTriggerDefinitions,
  useReadOnly,
} from '../hooks'
import { useContextMenu } from '../hooks/use-context-menu'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import { useWorkflowStore } from '../store/workflow-store'
import { NodeType } from '../types/node-types'
import { BlockSelector } from './block-selector'

/**
 * Node context menu - single instance using existing DropdownMenu
 * Positioned via an invisible trigger at the right-click location
 */
export const NodeContextMenu = memo(() => {
  const nodes = useNodes()

  // Store selectors
  const nodeMenu = useWorkflowStore((state) => state.nodeMenu)

  // Hooks
  const { handleNodeContextMenuClose } = useContextMenu()
  const {
    handleCopyNode,
    handleDeleteNode,
    handleCenterOnNode,
    handleNodeDisable,
    handleToggleCollapse,
  } = useNodesInteractions()
  const { isReadOnly } = useReadOnly()
  const nonTriggerDefinitions = useNonTriggerDefinitions()
  const { addNode } = useNodeAddition()

  // Find the current node from the nodeId in menu state
  const currentNode = useMemo(() => {
    if (!nodeMenu?.nodeId) return null
    return nodes.find((node) => node.id === nodeMenu.nodeId) as Node | null
  }, [nodes, nodeMenu?.nodeId])

  // Don't render if no menu or no node found
  if (!currentNode) {
    return null
  }

  const nodeType = currentNode.data.type as string
  const isTrigger = unifiedNodeRegistry.isTrigger(nodeType)
  const isDisabled = currentNode.data.disabled
  const isCollapsed = currentNode.data.collapsed

  // Filter available node types for replacement
  const availableNodeTypes = nonTriggerDefinitions
    .filter((def) => def.id !== nodeType && def.id !== NodeType.END)
    .map((def) => def.id)

  // Check if node can be disabled
  const canBeDisabled = nodeType !== NodeType.MESSAGE_RECEIVED && nodeType !== NodeType.END

  // Handle block replacement
  const handleBlockSelect = async (selectedNodeType: string, config?: any) => {
    try {
      await addNode({
        nodeType: selectedNodeType,
        position: 'replace',
        replaceNodeId: currentNode.id,
        config,
      })
      handleNodeContextMenuClose()
    } catch (error) {
      console.error('Failed to replace node:', error)
    }
  }

  return (
    <DropdownMenu open={!!nodeMenu} onOpenChange={(open) => !open && handleNodeContextMenuClose()}>
      {/* Invisible trigger positioned at click location */}
      <DropdownMenuTrigger asChild>
        <div
          className='absolute w-0 h-0 pointer-events-none'
          style={{
            left: nodeMenu?.left ?? 0,
            top: nodeMenu?.top ?? 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {/* Change Block - only for non-triggers */}
        {!isTrigger && !isReadOnly && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <RefreshCw />
                Change Block
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
            <DropdownMenuSeparator />
          </>
        )}

        {/* Standard actions */}
        {!isReadOnly && (
          <>
            <DropdownMenuItem
              onClick={() => {
                handleCopyNode(currentNode.id)
                handleNodeContextMenuClose()
              }}>
              <Copy />
              Copy
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                handleCenterOnNode(currentNode.id)
                handleNodeContextMenuClose()
              }}>
              <Target />
              Center on Node
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                handleToggleCollapse([currentNode.id])
                handleNodeContextMenuClose()
              }}>
              {isCollapsed ? <UnfoldVertical /> : <FoldVertical />}
              {isCollapsed ? 'Expand' : 'Collapse'}
            </DropdownMenuItem>
            {canBeDisabled && (
              <DropdownMenuItem
                onClick={() => {
                  handleNodeDisable([currentNode], !isDisabled)
                  handleNodeContextMenuClose()
                }}>
                {isDisabled ? <Power /> : <PowerOff />}
                {isDisabled ? 'Enable Node' : 'Disable Node'}
                <DropdownMenuShortcut>D</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Delete - only for non-triggers */}
        {!isTrigger && !isReadOnly && (
          <DropdownMenuItem
            variant='destructive'
            onClick={() => {
              handleDeleteNode(currentNode.id)
              handleNodeContextMenuClose()
            }}>
            <Trash2 />
            Delete
            <DropdownMenuShortcut>Del</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

NodeContextMenu.displayName = 'NodeContextMenu'
