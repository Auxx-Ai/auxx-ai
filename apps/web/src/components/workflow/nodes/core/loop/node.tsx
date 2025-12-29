// apps/web/src/components/workflow/nodes/core/loop/node.tsx

import { type FC, memo, useEffect } from 'react'
import { type LoopNode as LoopNodeType } from './types'
import { LOOP_HANDLES } from './constants'
import {
  useNodeStatus,
  useLoopProgress,
  useAvailableBlocks,
  useNodeDimensions,
  useLoopConfig,
} from '~/components/workflow/hooks'
import { NodeTargetHandle, NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import { Check, Clock, Home, Plus, XCircle } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { NodeResizer } from '~/components/workflow/ui/node-resizer'
import { useNodesInitialized, useStoreApi } from '@xyflow/react'
import { unifiedNodeRegistry } from '../../unified-registry'
import { NodeRunningStatus, NodeType } from '~/components/workflow/types'
import { Tooltip } from '~/components/global/tooltip'
import { Button } from '@auxx/ui/components/button'

type LoopStartProps = Pick<LoopNodeType, 'id' | 'data'>

const LoopStart: FC<LoopStartProps> = memo(({ id, data }) => {
  return (
    <div className="absolute top-12 left-2 nodrag group mt-1 flex size-10 items-center justify-center rounded-2xl border  bg-background">
      <Tooltip content="Start of Loop">
        <div className="flex size-6 items-center justify-center rounded-full border-[0.5px] border-info bg-info">
          <Home className="size-4 text-white" />
        </div>
      </Tooltip>
      <NodeSourceHandle
        id={id}
        data={{ ...data, isInLoop: true, loopId: id, _isLoopStart: true }}
        handleId={LOOP_HANDLES.LOOP_START}
        handleClassName="top-[50%]! right-[0]! z-[1009] w-1"
      />
    </div>
  )
})

const LoopEnd: FC<LoopStartProps> = memo(({ id, data }) => {
  return (
    <div className="absolute right-2 bottom-2 nodrag group mt-1 flex size-10 items-center justify-center rounded-2xl border  bg-background">
      <Tooltip content="Loop Back">
        <div className="flex size-6 items-center justify-center rounded-full border-[0.5px] border-info bg-info">
          <Home className="size-4 text-white" />
        </div>
      </Tooltip>
      <NodeTargetHandle
        id={id}
        data={data}
        handleId={LOOP_HANDLES.LOOP_BACK}
        handleClassName="top-[50%] !left-0 w-1"
      />
    </div>
  )
})

export const LoopNode: FC<LoopNodeType> = memo((props) => {
  const { id, data, selected } = props
  const nodeStatus = useNodeStatus(id)
  const isDisabled = data.disabled || false

  const store = useStoreApi()
  const { nodes } = store.getState()
  const nodesInitialized = useNodesInitialized()

  const loopProgress = useLoopProgress(id)

  const { handleNodeLoopRerender } = useLoopConfig()
  useEffect(() => {
    if (nodesInitialized) handleNodeLoopRerender(id)
  }, [nodesInitialized, id, handleNodeLoopRerender])

  const childrenNodes = nodes.filter((n) => n.parentId === id)

  const hasChildNodes = childrenNodes.length > 0
  const icon = unifiedNodeRegistry.getNodeIcon(data.type)
  const color = unifiedNodeRegistry.getColor(data.type)

  // Get available blocks for inside the loop - use LOOP nodeType to get all flow nodes
  const { availableNextBlocks } = useAvailableBlocks(NodeType.LOOP, false, 'source')

  // Monitor node dimensions for proper selection bounds
  // const nodeRef = useNodeDimensions(id, [data])

  return (
    <div
      // ref={nodeRef}
      className={cn(
        'workflow-node relative group/node',
        'border-[1px] rounded-2xl',
        'transition-all duration-200',
        'after:opacity-0 bg-foreground/3 after:absolute after:inset-[-9px] after:pointer-events-none after:rounded-[24px] after:border-[8px] after:border-primary-300/20 hover:after:opacity-100',
        {
          'border-red-500 hover:border-red-600':
            nodeStatus === NodeRunningStatus.Failed && !isDisabled,
          'border-good-500 hover:border-good-600':
            nodeStatus === NodeRunningStatus.Succeeded && !isDisabled,
        }
      )}
      style={{ width: '100%', height: '100%' }}>
      {selected && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none rounded-2xl border-2 transition-all duration-200 group-hover/node:opacity-100',
            'border-purple-500',
            nodeStatus === NodeRunningStatus.Failed && 'border-red-500',
            nodeStatus === NodeRunningStatus.Succeeded && 'border-good-500'
          )}
        />
      )}
      <div className="flex items-center gap-2 pt-3 px-3 pb-2 bg-background rounded-t-2xl border-b">
        {icon && (
          <div
            className="flex-shrink-0 border rounded-md bg-primary-50 size-7 flex items-center justify-center"
            style={{ color }}>
            {icon}
          </div>
        )}
        <div
          title={data.title}
          className="font-semibold text-sm mr-1 flex grow items-center truncate">
          <div className="">{data.title}</div>
        </div>
        {nodeStatus === NodeRunningStatus.Succeeded ? (
          <div className="me-3 rounded-full border p-0.5 border-good-500 bg-good-50">
            <Check className="size-3 text-green-500" />
          </div>
        ) : nodeStatus === NodeRunningStatus.Failed ? (
          <div className="me-3 rounded-full border p-0.5 border-destructive-500 bg-destructive-50">
            <XCircle className="size-3 text-destructive-500" />
          </div>
        ) : nodeStatus === NodeRunningStatus.Running ? (
          <div className="me-3 rounded-full border p-0.5 border-warning-500 bg-warning-50">
            <Clock className="size-3 text-warning-500" />
          </div>
        ) : null}
      </div>
      <LoopStart id={id} data={data} />

      {/* Input - where flow enters the loop */}
      <div className="relative top-0 left-0">
        <NodeTargetHandle id={id} data={data} handleId="target" handleClassName="!top-[20%]" />
      </div>

      {/* Output - where flow exits the loop after completion */}
      <NodeSourceHandle id={id} data={data} handleId="source" />

      {/* Loop content area */}
      <div className="absolute top-15 left-16">
        {!hasChildNodes && (
          <AddNodeTrigger
            anchorNode={{ id, type: 'loop', position: props.position, data }}
            position="inside"
            parentNodeId={id}
            allowedNodeTypes={availableNextBlocks}
            onNodeAdded={(nodeId) => {
              console.log('Added node inside loop:', nodeId)
            }}>
            <Button variant="outline" size="sm" className="z-10">
              <Plus />
              Add node inside loop
            </Button>
          </AddNodeTrigger>
        )}
      </div>
      <LoopEnd id={id} data={data} />
      {/* Loop information display */}
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {/* Progress indicator during execution */}
          {loopProgress && loopProgress.status === 'running' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono">
                {loopProgress.currentIteration + 1}/{loopProgress.totalIterations}
              </span>
              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 transition-all duration-300"
                  style={{
                    width: `${((loopProgress.currentIteration + 1) / loopProgress.totalIterations) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <NodeResizer nodeId={id} />
    </div>
  )
})

LoopNode.displayName = 'LoopNode'
