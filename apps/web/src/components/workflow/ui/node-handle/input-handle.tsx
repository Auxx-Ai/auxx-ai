// apps/web/src/components/workflow/ui/node-handle/input-handle.tsx

import React, { memo, useCallback, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { type NodeHandleProps } from './types'
import { useReadOnly, useAvailableBlocks, useNodeStatus } from '~/components/workflow/hooks'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import { cn } from '@auxx/ui/lib/utils'
import { Plus } from 'lucide-react'

export const NodeInputHandle = memo(
  ({ id, data, handleId, handleClassName, type = 'default' }: NodeHandleProps) => {
    const { isReadOnly } = useReadOnly()
    const { availableNextBlocks: availableInputBlocks } = useAvailableBlocks(
      data.type,
      data.isInLoop,
      'input'
    )
    const nodeStatus = useNodeStatus(id)
    const isConnectable = !!availableInputBlocks?.length
    const [triggerOpen, setTriggerOpen] = useState(false)

    // Debug logging (uncomment for debugging)
    // console.log('[NodeInputHandle] Debug:', {
    //   id,
    //   nodeType: data.type,
    //   handleId,
    //   availableInputBlocks,
    //   isConnectable,
    //   isReadOnly,
    // })

    const connected = data._connectedTargetHandleIds?.includes(handleId)

    // Create anchor node object for AddNodeTrigger
    const anchorNode = {
      id,
      type: data.type,
      position: { x: 0, y: 0 }, // Position will be determined by the service
      data,
    }

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        if (isConnectable && !isReadOnly) {
          setTriggerOpen(true)
        }
      },
      [isConnectable, isReadOnly]
    )

    if (isConnectable && !isReadOnly) {
      return (
        <div
          className={cn(
            'node-handle group/handle absolute left-0 top-1/2 z-[1] flex -translate-y-1/2 items-center',
            handleClassName
          )}>
          <Handle
            id={handleId}
            type="target"
            position={Position.Left}
            className={cn(
              ' z-3 !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
              'after:absolute after:left-[5px] after:top-1 after:h-2 after:w-0.5 after:bg-comparison-500',
              nodeStatus === 'success' && 'after:bg-green-500',
              nodeStatus === 'error' && 'after:bg-red-500',
              nodeStatus === 'running' && 'after:bg-orange-500',
              'cursor-pointer'
            )}
            onClick={handleClick}
            isConnectable={isConnectable}>
            <AddNodeTrigger
              anchorNode={anchorNode}
              targetHandle={handleId}
              position="before"
              allowedNodeTypes={availableInputBlocks || []}
              open={triggerOpen}
              align="center"
              onOpenChange={setTriggerOpen}
              onNodeAdded={() => setTriggerOpen(false)}>
              <button
                className={cn(
                  'z-2 opacity-0 group-hover/node:opacity-100 size-4 rounded-full bg-comparison-500 text-primary-foreground',
                  'flex items-center justify-center shadow-md absolute pointer-events-none',
                  'hover:scale-110 transition-transform'
                )}>
                <Plus className="w-4 h-4" />
              </button>
            </AddNodeTrigger>
            <div className="absolute -top-1 right-1/2 hidden translate-x-1/2 -translate-y-full z-[2] rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none">
              <div className="text-xs text-muted-foreground">
                <div className="whitespace-nowrap">
                  <span className="font-medium text-foreground">Click:</span>
                  {' Add input node'}
                </div>
                <div>
                  <span className="font-medium text-foreground">Drag:</span>
                  {' Connect existing input node'}
                </div>
              </div>
            </div>
          </Handle>
        </div>
      )
    }

    return (
      <Handle
        id={handleId}
        type="target"
        position={Position.Left}
        className={cn(
          'node-handle group/handle z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
          'after:absolute after:left-1.5 after:top-1 after:h-2 after:w-0.5 after:bg-border',
          'transition-all hover:scale-125',
          nodeStatus === 'success' && 'after:bg-green-500',
          nodeStatus === 'error' && 'after:bg-red-500',
          nodeStatus === 'running' && 'after:bg-orange-500',
          handleClassName
        )}
        isConnectable={false}>
        {isReadOnly && (
          <div className="absolute -top-1 right-1/2 hidden translate-x-1/2 -translate-y-full z-[2] rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none">
            <div className="text-xs text-muted-foreground">
              <div className="whitespace-nowrap text-muted-foreground">
                Read-only mode - editing disabled
              </div>
            </div>
          </div>
        )}
      </Handle>
    )
  }
)

NodeInputHandle.displayName = 'NodeInputHandle'
