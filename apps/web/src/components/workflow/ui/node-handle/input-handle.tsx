// apps/web/src/components/workflow/ui/node-handle/input-handle.tsx

import { cn } from '@auxx/ui/lib/utils'
import { Handle, Position } from '@xyflow/react'
import { Plus } from 'lucide-react'
import type React from 'react'
import { memo, useCallback } from 'react'
import { useAvailableBlocks, useNodeStatus, useReadOnly } from '~/components/workflow/hooks'
import { useNodeAddition } from '~/components/workflow/hooks/use-node-addition'
import type { NodeHandleProps } from './types'

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
    const { addNode, selectNewNode } = useNodeAddition()

    /** Directly add a form-input node connected to this handle */
    const handleClick = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        if (!isConnectable || isReadOnly) return

        const newNodeId = await addNode({
          nodeType: 'form-input',
          position: 'before',
          anchorNode: { id, targetHandle: handleId },
        })
        selectNewNode(newNodeId)
      },
      [isConnectable, isReadOnly, addNode, selectNewNode, id, handleId]
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
            type='target'
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
            <button
              className={cn(
                'z-2 opacity-0 group-hover/node:opacity-100 size-4 rounded-full bg-comparison-500 text-primary-foreground',
                'flex items-center justify-center shadow-md absolute pointer-events-none',
                'hover:scale-110 transition-transform'
              )}>
              <Plus className='w-4 h-4' />
            </button>
            <div className='absolute -top-1 right-1/2 hidden translate-x-1/2 -translate-y-full z-[2] rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none'>
              <div className='text-xs text-muted-foreground'>
                <div className='whitespace-nowrap'>
                  <span className='font-medium text-foreground'>Click:</span>
                  {' Add input'}
                </div>
                <div>
                  <span className='font-medium text-foreground'>Drag:</span>
                  {' Connect existing input'}
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
        type='target'
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
          <div className='absolute -top-1 right-1/2 hidden translate-x-1/2 -translate-y-full z-[2] rounded-lg border-[0.5px] border-border bg-popover p-1.5 shadow-lg group-hover/handle:block pointer-events-none'>
            <div className='text-xs text-muted-foreground'>
              <div className='whitespace-nowrap text-muted-foreground'>
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
