// apps/web/src/components/workflow/ui/next-step/add.tsx

import { memo, useMemo } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useAvailableBlocks, useReadOnly } from '~/components/workflow/hooks'
import { Plus } from 'lucide-react'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import type { AddProps } from './types'
import { cn } from '@auxx/ui/lib/utils'

const Add = ({ nodeId, nodeData, sourceHandle, isParallel, branchType = 'default' }: AddProps) => {
  const { isReadOnly } = useReadOnly()
  const nodesReadOnly = isReadOnly
  const { getNodes } = useReactFlow()
  const nodes = getNodes()

  // Check if the current node is inside a loop by checking parent chain
  const isInsideLoop = useMemo(() => {
    let currentNode = nodes.find((n) => n.id === nodeId)
    while (currentNode) {
      if (currentNode.parentId) {
        const parent = nodes.find((n) => n.id === currentNode.parentId)
        if (parent && parent.type === 'loop') {
          return true
        }
        currentNode = parent
      } else {
        break
      }
    }
    return false
  }, [nodes, nodeId])

  const { availableNextBlocks } = useAvailableBlocks(nodeData.type, isInsideLoop, 'source')

  // Create anchor node object for AddNodeTrigger
  const anchorNode = {
    id: nodeId,
    type: nodeData.type,
    position: { x: 0, y: 0 }, // Position will be determined by the service
    data: nodeData,
  }

  let title = isParallel ? 'Add parallel node' : 'Add next step'
  if (branchType === 'fail') {
    title = isParallel ? 'Add parallel fail branch' : 'Add fail branch'
  }

  // If no blocks are available or in read-only mode, show disabled state
  if (!availableNextBlocks.length || nodesReadOnly) {
    return (
      <button
        className={cn(
          'relative flex h-9 w-full cursor-not-allowed items-center rounded-lg border border-dashed px-2 text-xs text-primary-400 bg-primary-50 opacity-50',
          branchType === 'fail' && 'text-bad-500 bg-bad-50 border-bad-200'
        )}
        disabled={true}>
        <div className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-[5px] bg-background">
          <Plus className="h-3 w-3" />
        </div>
        <div className="flex items-center uppercase">{title}</div>
      </button>
    )
  }

  return (
    <AddNodeTrigger
      anchorNode={anchorNode}
      sourceHandle={sourceHandle}
      position={isParallel ? 'parallel' : 'after'}
      branchType={branchType}
      allowedNodeTypes={availableNextBlocks}>
      <button
        className={cn(
          'relative flex h-9 w-full cursor-pointer items-center rounded-lg border border-dashed px-2 text-xs text-primary-400 bg-primary-50 hover:bg-primary-100 transition-colors',
          branchType === 'fail' && 'text-bad-500 bg-bad-50 hover:bg-bad-100 border-bad-200'
        )}>
        <div className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-[5px] bg-background">
          <Plus className="h-3 w-3" />
        </div>
        <div className="flex items-center uppercase">{title}</div>
      </button>
    </AddNodeTrigger>
  )
}

export default memo(Add)
