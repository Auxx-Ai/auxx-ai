// apps/web/src/components/workflow/nodes/core/find/node.tsx

'use client'

import { type FC, memo } from 'react'
import { Search, Filter, ArrowUpDown } from 'lucide-react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import { type FindNodeData } from './types'
import { type NodeProps } from '@xyflow/react'
import { useWorkflowResources } from '../../../providers'

interface FindNodeProps extends NodeProps {
  data: FindNodeData
}

/**
 * Find node component
 * Displays a node with input handle and single output handle
 */
const FindNodeComponent: FC<FindNodeProps> = ({ id, data, selected, ...props }) => {
  const { getResourceById } = useWorkflowResources()

  // Get resource and display info
  const resourceType = data.resourceType || 'contact'
  const findMode = data.findMode || 'findMany'
  const filterCount = (data.conditionGroups || []).reduce(
    (total, group) => total + group.conditions.length,
    0
  )
  const resource = getResourceById(resourceType)

  /**
   * Get display text for filters
   */
  const getFilterDisplay = () => {
    if (filterCount === 0) return 'No filters'
    return `${filterCount} filter${filterCount === 1 ? '' : 's'}`
  }

  /**
   * Get display text for find mode
   */
  const getFindModeDisplay = () => {
    return findMode === 'findOne' ? 'Find One' : 'Find Many'
  }

  /**
   * Get display text for ordering
   */
  const getOrderDisplay = () => {
    if (!data.orderBy) return 'No sorting'
    return `Sort by ${data.orderBy.field} (${data.orderBy.direction.toUpperCase()})`
  }

  return (
    <BaseNode {...props} data={data} id={id} selected={selected}>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />
      <div className="relative px-3 pb-2 space-y-1">
        {/* Resource type and find mode */}
        <div className="relative flex items-center justify-between h-6 rounded-md bg-muted px-2">
          <div className="flex items-center gap-1">
            <Search className="size-3" />
            <div className="text-sm font-medium">
              {getFindModeDisplay()} {resource?.label || resourceType}
            </div>
          </div>
        </div>

        {/* Filters display */}
        {filterCount > 0 && (
          <div className="relative flex items-center justify-between h-6 rounded-md bg-accent-50 px-2">
            <div className="flex items-center gap-1">
              <Filter className="size-3 text-accent-500" />
              <div className="text-xs text-accent-600">{getFilterDisplay()}</div>
            </div>
          </div>
        )}

        {/* Ordering display */}
        {data.orderBy && (
          <div className="relative flex items-center justify-between h-6 rounded-md bg-comparison-50 px-2">
            <div className="flex items-center gap-1">
              <ArrowUpDown className="size-3 text-comparison-500" />
              <div className="text-xs text-comparison-600">{getOrderDisplay()}</div>
            </div>
          </div>
        )}

        {/* Limit display for findMany */}
        {data.findMode === 'findMany' && data.limit && (
          <div className="relative flex items-center justify-between h-6 rounded-md bg-bad-50 px-2">
            <div className="text-xs text-bad-600">Limit: {data.limit} results</div>
          </div>
        )}

        {/* Output handle */}
        {/* <div className="relative flex items-center justify-end h-6 rounded-md bg-good-50">
          <div className="text-xs rounded-md px-1 font-semibold uppercase bg-good-100 text-good-600 whitespace-pre-line">
            Results
          </div>
          
        </div> */}
      </div>
      <NodeSourceHandle
        id={id}
        data={{ ...data, selected }}
        handleId="source"
        handleClassName="!top-1/2 !-right-[0px]"
      />
    </BaseNode>
  )
}

export const FindNode = memo(FindNodeComponent)

FindNode.displayName = 'FindNode'
