// apps/web/src/components/workflow/ui/add-node-trigger.tsx

import { toastError } from '@auxx/ui/components/toast'
import { useReactFlow } from '@xyflow/react'
import { cloneElement, isValidElement, type ReactElement, useCallback, useState } from 'react'
import { useNodeAddition } from '../hooks/use-node-addition'
import { useReadOnly } from '../hooks/use-read-only'
import { BlockSelector } from './block-selector'

export interface AddNodeTriggerProps {
  // Required: The trigger element
  children: ReactElement

  // Context for node positioning
  anchorNode?: { id: string; type: string; position: { x: number; y: number }; data: any }

  // Handle information for edge creation
  sourceHandle?: string // When adding after a node
  targetHandle?: string // When adding before a node

  // Position context
  position?: 'after' | 'before' | 'parallel' | 'standalone' | 'between' | 'replace' | 'inside'

  // For 'inside' position - the parent node to add to
  parentNodeId?: string

  // For 'between' position - the target node to connect to
  targetNode?: { id: string; targetHandle?: string }

  // For 'replace' position - the node to replace
  replaceNodeId?: string

  // Behavioral options
  closeOnSelect?: boolean // Default: true
  selectOnCreate?: boolean // Default: true
  allowedNodeTypes?: string[] // Filter available nodes

  // Callbacks
  onNodeAdded?: (nodeId: string, nodeType: string) => void
  onCancel?: () => void
  onBeforeAdd?: (nodeType: string) => boolean | Promise<boolean> // Validation

  // Advanced options
  customPosition?: { x: number; y: number }
  branchType?: string // For conditional nodes
  // External control
  open?: boolean

  // popover options
  side?: 'left' | 'right' | 'top' | 'bottom'
  sideOffset?: number
  align?: 'start' | 'center' | 'end' // Align trigger with selector
  alignOffset?: number
  onOpenChange?: (open: boolean) => void
}

export function AddNodeTrigger({
  children,
  anchorNode,
  sourceHandle,
  targetHandle,
  targetNode,
  parentNodeId,
  replaceNodeId,
  position = 'after',
  closeOnSelect = true,
  selectOnCreate = true,
  allowedNodeTypes,
  onNodeAdded,
  onCancel,
  onBeforeAdd,
  customPosition,
  branchType,
  open: externalOpen,
  onOpenChange,
  ...props
}: AddNodeTriggerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const reactFlowInstance = useReactFlow()
  const { isReadOnly } = useReadOnly()
  const { addNode, selectNewNode, closeAllSelectors } = useNodeAddition()

  // Use external state if provided, otherwise use internal state
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen
  const setIsOpen = useCallback(
    (open: boolean) => {
      if (onOpenChange) {
        onOpenChange(open)
      } else {
        setInternalOpen(open)
      }
    },
    [onOpenChange]
  )

  const handleNodeSelect = useCallback(
    async (nodeType: string, config?: any) => {
      if (isAdding) return

      // Optional validation
      if (onBeforeAdd) {
        const shouldAdd = await onBeforeAdd(nodeType)
        if (!shouldAdd) return
      }

      setIsAdding(true)

      try {
        // Prepare addition context
        const context = {
          nodeType,
          position,
          anchorNode: anchorNode
            ? { id: anchorNode.id, sourceHandle: sourceHandle, targetHandle: targetHandle }
            : undefined,
          targetNode,
          parentNodeId,
          replaceNodeId,
          config,
          viewport: { x: 0, y: 0, zoom: 1 },
          customPosition,
          branchType,
        }
        // Add node through unified hook
        const nodeId = await addNode(context)

        // Close selector if configured
        if (closeOnSelect) {
          setIsOpen(false)
          closeAllSelectors()
        }

        // Select new node if configured
        if (selectOnCreate) {
          selectNewNode(nodeId)
        }

        // Trigger callback
        onNodeAdded?.(nodeId, nodeType)
      } catch (error: any) {
        console.error('Failed to add node:', error)

        // User-friendly error messages
        if (error.message === 'INVALID_CONNECTION') {
          toastError({
            title: 'Invalid connection',
            description: 'These node types cannot be connected',
          })
        } else if (error.message === 'CYCLE_DETECTED') {
          toastError({
            title: 'Cycle detected',
            description: 'This connection would create a cycle',
          })
        } else if (error.message === 'MAX_CONNECTIONS') {
          toastError({
            title: 'Connection limit reached',
            description: 'This handle has reached the maximum number of connections',
          })
        } else {
          toastError({
            title: 'Failed to add node',
            description: error.message || 'An unexpected error occurred',
          })
        }
      } finally {
        setIsAdding(false)
      }
    },
    [
      isAdding,
      position,
      anchorNode,
      sourceHandle,
      targetHandle,
      parentNodeId,
      customPosition,
      branchType,
      closeOnSelect,
      selectOnCreate,
      onNodeAdded,
      onBeforeAdd,
      reactFlowInstance,
      // nodeAdditionService,
    ]
  )

  const handleCancel = useCallback(() => {
    setIsOpen(false)
    onCancel?.()
  }, [onCancel])

  // Handle trigger click
  const handleTriggerClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      // Call original onClick if it exists
      const childProps = children.props as any
      if (childProps?.onClick && typeof childProps.onClick === 'function') {
        childProps.onClick(e)
      }

      // Open selector
      if (!isAdding && !isReadOnly) {
        setIsOpen(true)
      }
    },
    [children, isAdding, isReadOnly]
  )

  // Don't render in read-only mode
  // if (isReadOnly) return null

  // Validate children
  if (!isValidElement(children)) {
    console.error('AddNodeTrigger requires a single React element as children')
    return null
  }

  // Clone children and inject props
  const trigger = cloneElement(
    children as ReactElement<any>,
    {
      onClick: handleTriggerClick,
      disabled: (children.props as any)?.disabled || isAdding || isReadOnly,
      'aria-expanded': isOpen,
      'aria-haspopup': 'menu',
    } as any
  )

  return (
    <BlockSelector
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) {
          handleCancel()
        }
      }}
      onSelect={handleNodeSelect}
      customTrigger={trigger}
      availableBlocksTypes={allowedNodeTypes || []}
      asChild={true}
      {...props}
    />
  )
}
