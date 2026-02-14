// apps/web/src/components/workflow/ui/node-handle/target-handle.tsx

import { cn } from '@auxx/ui/lib/utils'
import { Handle } from '@xyflow/react'
import { memo } from 'react'
import { useAvailableBlocks, useReadOnly } from '~/components/workflow/hooks'
import {
  getIndicatorClass,
  getPositionClass,
  type HandlePosition,
  mapPosition,
} from './handle-position-utils'
import { type NodeHandleProps, NodeRunningStatus } from './types'

export const NodeTargetHandle = memo(
  ({
    id,
    data,
    handleId,
    handleClassName,
    nodeSelectorClassName,
    position = 'left',
  }: NodeHandleProps & { position?: HandlePosition }) => {
    const { isReadOnly } = useReadOnly()
    const connected = data._connectedTargetHandleIds?.includes(handleId)
    const { availablePrevBlocks } = useAvailableBlocks(
      data.type,
      data.isInIteration || data.isInLoop,
      'target'
    )
    const isConnectable = !!availablePrevBlocks.length && !isReadOnly

    // Create anchor node object for AddNodeTrigger
    const anchorNode = {
      id,
      type: data.type,
      position: { x: 0, y: 0 }, // Position will be determined by the service
      data,
    }

    return (
      <div className={cn('node-handle absolute z-[1]', getPositionClass(position))}>
        <Handle
          id={handleId}
          type='target'
          position={mapPosition(position)}
          className={cn(
            'group/handle z-[1] !h-4 !w-4 !rounded-none !border-none !bg-transparent !outline-none',
            'after:absolute after:bg-border',
            getIndicatorClass(position),
            'transition-all hover:scale-125 after:bg-info',
            data._runningStatus === NodeRunningStatus.Succeeded && 'after:bg-green-500',
            data._runningStatus === NodeRunningStatus.Failed && 'after:bg-red-500',
            data._runningStatus === NodeRunningStatus.Exception && 'after:bg-orange-500',
            // !connected && 'after:opacity-0',
            data.type === 'start' && 'opacity-0'
          )}
          isConnectable={isConnectable}
        />
        {/* {!connected && isConnectable && !isReadOnly && (
          <AddNodeTrigger
            anchorNode={anchorNode}
            targetHandle={handleId}
            position="before"
            allowedNodeTypes={availablePrevBlocks}>
            <button
              className={cn(
                'z-2 opacity-0 group-hover/node:opacity-100  absolute -left-2 -translate-y-1/2 size-4 rounded-full bg-blue-500 text-primary-foreground',
                'flex items-center justify-center shadow-md',
                'hover:scale-110 transition-transform'
              )}>
              <Plus className="w-4 h-4" />
            </button>
          </AddNodeTrigger>
        )} */}
      </div>
    )
  }
)

NodeTargetHandle.displayName = 'NodeTargetHandle'
