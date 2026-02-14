// apps/web/src/components/workflow/nodes/shared/base/base-node.tsx

import { ShineBorder } from '@auxx/ui/components/shine-border'
import { cn } from '@auxx/ui/lib/utils'
import { useUpdateNodeInternals } from '@xyflow/react'
import { Check, ChevronDown, Clock, XCircle } from 'lucide-react'
import React, { memo, type ReactNode, useEffect, useMemo } from 'react'
import { useNodeStatus, useNodeValidationErrors } from '~/components/workflow/hooks'
import { useNodesInteractions } from '~/components/workflow/hooks/use-node-interactions'
import { type BaseNodeData, NodeRunningStatus } from '../../../types'
import { unifiedNodeRegistry } from '../../unified-registry'
import { NodeValidationWarning } from '../node-validation-warning'

/** Collapsed node dimensions */
const COLLAPSED_WIDTH = 70
const COLLAPSED_MIN_HEIGHT = 70
const COLLAPSED_HEIGHT_PER_HANDLE = 20

interface BaseNodeProps {
  id: string
  data: BaseNodeData
  selected?: boolean
  width?: number
  height?: number | 'auto'
  className?: string
  children: ReactNode
  nodeType?: 'standard' | 'input'
}

/** Status indicator component */
const StatusIndicator = ({
  status,
  size = 3,
}: {
  status: NodeRunningStatus | null
  size?: 2 | 3
}) => {
  if (status === NodeRunningStatus.Succeeded) {
    return (
      <div className='rounded-full border p-0.5 border-good-500 bg-good-50'>
        <Check className={cn(size === 2 ? 'size-2' : 'size-3', 'text-green-500')} />
      </div>
    )
  }
  if (status === NodeRunningStatus.Failed) {
    return (
      <div className='rounded-full border p-0.5 border-destructive-500 bg-destructive-50'>
        <XCircle className={cn(size === 2 ? 'size-2' : 'size-3', 'text-destructive-500')} />
      </div>
    )
  }
  if (status === NodeRunningStatus.Running) {
    return (
      <div className='rounded-full border p-0.5 border-warning-500 bg-warning-50'>
        <Clock className={cn(size === 2 ? 'size-2' : 'size-3', 'text-warning-500')} />
      </div>
    )
  }
  return null
}

/**
 * Base node component that provides common styling and structure.
 * Supports collapsed state for visual compaction.
 *
 * When collapsed, uses CSS to hide content while keeping handles visible.
 * Handles have `.node-handle` class and use absolute positioning.
 */
export const BaseNode = memo<BaseNodeProps>(
  ({ id, data, selected, className, children, nodeType = 'standard' }) => {
    const status = useNodeStatus(id)
    const isDisabled = data.disabled || false
    const isCollapsed = data.collapsed || false
    const icon = unifiedNodeRegistry.getNodeIcon(data.type, 'size-4', data)
    const color = unifiedNodeRegistry.getColor(data.type)
    const { handleToggleCollapse } = useNodesInteractions()
    const updateNodeInternals = useUpdateNodeInternals()
    const isTriggerNode = unifiedNodeRegistry.isTrigger(data.type)
    const canCollapse = !isTriggerNode
    const isEffectivelyCollapsed = isCollapsed && canCollapse
    const validation = useNodeValidationErrors({ nodeId: id, data, enabled: !isDisabled })
    const isSelected = selected || data._isBundled

    // Calculate collapsed height based on handle count
    const sourceHandleCount = (data as any)._sourceHandleCount || 1
    const targetHandleCount = (data as any)._targetHandleCount || 1
    const maxHandles = Math.max(sourceHandleCount, targetHandleCount)
    const collapsedHeight = Math.max(COLLAPSED_MIN_HEIGHT, maxHandles * COLLAPSED_HEIGHT_PER_HANDLE)

    // Notify React Flow to recalculate edge positions when collapsed state changes
    useEffect(() => {
      updateNodeInternals(id)
    }, [id, updateNodeInternals])

    /** Handle collapse toggle click */
    const onCollapseToggle = (e: React.MouseEvent) => {
      e.stopPropagation()
      handleToggleCollapse([id])
    }

    const containerClassName = useMemo(
      () =>
        cn(
          'workflow-node relative group/node border rounded-2xl transition-all duration-200',
          'after:opacity-0 after:absolute after:inset-[-9px] after:rounded-[24px] after:border-[8px] hover:after:opacity-100 after:pointer-events-none',
          nodeType === 'standard' &&
            'bg-background/50 backdrop-blur-sm border-primary-300 dark:border-background/40 after:border-primary-300/20',
          nodeType === 'input' &&
            'bg-orange-50 dark:bg-amber-950 border-orange-300 dark:border-amber-900 after:border-orange-200/20 dark:after:border-amber-800/20',
          isSelected && !isDisabled && 'shadow-lg',
          status === NodeRunningStatus.Failed &&
            !isDisabled &&
            'border-red-500 hover:border-red-600',
          status === NodeRunningStatus.Succeeded &&
            !isDisabled &&
            'border-good-500 hover:border-good-600',
          (isDisabled || status === NodeRunningStatus.Pending) && 'opacity-50',
          !isSelected && data._inParallelHovering && 'border-foreground/10',
          className
        ),
      [nodeType, isSelected, isDisabled, status, data._inParallelHovering, className]
    )

    const selectedBorderClassName = useMemo(
      () =>
        cn(
          'absolute inset-[-2px] border-2 select-none rounded-2xl',
          !status && 'border-blue-500',
          !status && nodeType === 'input' && 'border-amber-500',
          status === NodeRunningStatus.Succeeded && 'border-good-500',
          status === NodeRunningStatus.Failed && 'border-red-500',
          status === NodeRunningStatus.Pending && 'border-primary-500',
          isDisabled && 'border-gray-400',
          className
        ),
      [status, nodeType, isDisabled, className]
    )

    return (
      <>
        <div
          className={containerClassName}
          style={
            isEffectivelyCollapsed ? { width: COLLAPSED_WIDTH, height: collapsedHeight } : undefined
          }>
          {/* Validation warnings - hidden when collapsed */}
          {!isEffectivelyCollapsed && validation.hasIssues && !isDisabled && (
            <NodeValidationWarning issues={validation.issues} />
          )}

          {/* Parallel node indicator - hidden when collapsed */}
          {!isEffectivelyCollapsed && data._inParallelHovering && (
            <div className='uppercase font-mono text-[8px] absolute -top-2.5 left-2 z-10 text-primary-400'>
              Parallel Node
            </div>
          )}

          {/* Running animation border */}
          {status === NodeRunningStatus.Running && (
            <ShineBorder
              borderWidth={2}
              className='absolute inset-[-2px]'
              shineColor={['#e92a67', '#a853ba', '#2a8af6']}
            />
          )}

          {/* Selection border */}
          {selected && <div className={selectedBorderClassName} />}

          {/* Main content wrapper */}
          <div className='group relative shadow-xs flex h-full w-full flex-col rounded-2xl'>
            {/* Header */}
            <div
              className={cn(
                'flex items-center',
                isEffectivelyCollapsed
                  ? 'inset-1 absolute justify-center'
                  : 'w-full justify-between'
              )}>
              <div
                className={cn(
                  'flex items-center',
                  isEffectivelyCollapsed ? 'gap-1' : 'gap-2 pt-2 px-2 pb-2 flex-1'
                )}>
                {/* Icon */}
                {icon && (
                  <div
                    className={cn(
                      'flex-shrink-0 border rounded-md bg-primary-50 flex items-center justify-center',
                      isEffectivelyCollapsed
                        ? 'rounded-[12px] mx-auto size-15 cursor-pointer [&_svg]:size-6'
                        : 'size-7'
                    )}
                    style={{ color }}
                    onClick={isEffectivelyCollapsed ? onCollapseToggle : undefined}
                    title={isEffectivelyCollapsed ? 'Expand node (K)' : undefined}>
                    {icon}
                  </div>
                )}

                {/* Title - only when expanded */}
                {!isEffectivelyCollapsed && (
                  <div
                    title={data.title}
                    className='font-semibold font-mono text-sm mr-1 flex grow items-center truncate text-foreground'>
                    {data.title}
                  </div>
                )}

                {/* Collapse toggle - only show when expanded and node can collapse */}
                {canCollapse && !isEffectivelyCollapsed && (
                  <button
                    onClick={onCollapseToggle}
                    className='flex-shrink-0 p-0.5 hover:bg-muted rounded transition-colors opacity-0 group-hover/node:opacity-100'
                    title='Collapse node (K)'>
                    <ChevronDown className='size-4 text-muted-foreground' />
                  </button>
                )}
              </div>

              {/* Status indicator */}
              <div className={cn(!isEffectivelyCollapsed && 'me-0')}>
                <StatusIndicator status={status} size={isEffectivelyCollapsed ? 2 : 3} />
              </div>
            </div>

            {/* Children container with handles */}
            <div
              className={cn(
                'flex-1 min-w-0',
                isEffectivelyCollapsed &&
                  [
                    '[&>*]:invisible [&>*]:h-0 [&>*]:overflow-visible',
                    '[&_.relative]:!static',
                    '[&_.node-handle]:!visible [&_.node-handle]:!absolute',
                    // Use CSS calc for positioning: ((index + 0.5) / total) * 100%
                    // Falls back to 50% for handles without index/total (single handles)
                    '[&_.node-handle]:!top-[calc((var(--handle-index,0)+0.5)/var(--handle-total,1)*100%)]',
                    '[&_.node-handle]:!-translate-y-1/2',
                    '[&_.node-handle]:!bottom-auto [&_.node-handle]:!h-auto',
                  ].join(' ')
              )}>
              {children}
            </div>
          </div>
        </div>

        {/* Title label below node when collapsed */}
        {isEffectivelyCollapsed && (
          <div className='text-xs font-medium ps-2 mt-1 truncate max-w-[70px] text-muted-foreground'>
            {data.title}
          </div>
        )}
      </>
    )
  }
)

BaseNode.displayName = 'BaseNode'
