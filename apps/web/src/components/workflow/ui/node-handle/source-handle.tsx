// apps/web/src/components/workflow/ui/node-handle/source-handle.tsx

import React, { memo, useCallback, useState } from 'react'
import { Handle } from '@xyflow/react'
import { type NodeHandleProps } from './types'
import { useReadOnly, useAvailableBlocks, useNodeStatus } from '~/components/workflow/hooks'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import { cn } from '@auxx/ui/lib/utils'
import { Plus } from 'lucide-react'
import {
  type HandlePosition,
  mapPosition,
  getPositionClass,
  getIndicatorClass,
} from './handle-position-utils'

export const NodeSourceHandle = memo(
  ({
    id,
    data,
    handleId,
    handleClassName,
    type = 'default',
    handleType = 'source',
    showAdd = true,
    position = 'right',
    handleIndex,
    handleTotal,
  }: NodeHandleProps & { position?: HandlePosition }) => {
    const { isReadOnly } = useReadOnly()
    const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInLoop, 'source')
    const nodeStatus = useNodeStatus(id)
    const isConnectable = !!availableNextBlocks.length
    const [triggerOpen, setTriggerOpen] = useState(false)

    const connected = data._connectedSourceHandleIds?.includes(handleId)

    // CSS custom properties for collapsed positioning
    const handleStyle =
      handleIndex !== undefined && handleTotal !== undefined
        ? ({ '--handle-index': handleIndex, '--handle-total': handleTotal } as React.CSSProperties)
        : undefined

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
            'node-handle group/handle absolute z-[1] flex items-center',
            getPositionClass(position),
            handleClassName
          )}
          style={handleStyle}>
          <Handle
            id={handleId}
            type={handleType}
            position={mapPosition(position)}
            className={cn(
              ' z-3 !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
              'after:absolute after:bg-info',
              getIndicatorClass(position),
              nodeStatus === 'success' && 'after:bg-green-500',
              nodeStatus === 'error' && 'after:bg-red-500',
              nodeStatus === 'running' && 'after:bg-orange-500',
              'cursor-pointer'
              // connected && 'after:opacity-0',
            )}
            onClick={handleClick}
            isConnectable={isConnectable}>
            {showAdd && (
              <>
                <AddNodeTrigger
                  anchorNode={anchorNode}
                  sourceHandle={handleId}
                  position={data._isLoopStart ? 'inside' : 'after'}
                  parentNodeId={data._isLoopStart ? id : undefined}
                  allowedNodeTypes={availableNextBlocks}
                  open={triggerOpen}
                  align="center"
                  onOpenChange={setTriggerOpen}
                  onNodeAdded={() => setTriggerOpen(false)}>
                  <button
                    className={cn(
                      'z-2 opacity-0 group-hover/node:opacity-100 size-4 rounded-full bg-blue-500 text-primary-foreground',
                      'flex items-center justify-center shadow-md absolute pointer-events-none',
                      'hover:scale-110 transition-transform',
                      type === 'fail' && 'bg-bad-500'
                    )}>
                    <Plus className="size-4" />
                  </button>
                </AddNodeTrigger>
                <div className="absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full z-3 rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none">
                  <div className="text-xs text-muted-foreground">
                    <div className="whitespace-nowrap">
                      <span className="font-medium text-foreground">Click:</span>
                      {' Add a new node'}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Drag:</span>
                      {' Connect to existing node'}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Handle>
        </div>
      )
    }

    return (
      <Handle
        id={handleId}
        type="source"
        position={mapPosition(position)}
        className={cn(
          'node-handle group/handle z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
          'after:absolute after:bg-border',
          getIndicatorClass(position),
          'transition-all hover:scale-125',
          nodeStatus === 'success' && 'after:bg-green-500',
          nodeStatus === 'error' && 'after:bg-red-500',
          nodeStatus === 'running' && 'after:bg-orange-500',
          handleClassName
        )}
        style={handleStyle}
        isConnectable={false}>
        {isReadOnly && (
          <div className="absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full z-[2] rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none">
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

NodeSourceHandle.displayName = 'NodeSourceHandle'
