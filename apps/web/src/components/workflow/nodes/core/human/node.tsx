// apps/web/src/components/workflow/nodes/core/human/node.tsx

import { Position } from '@xyflow/react'
import { Bell, Clock, Mail, Users } from 'lucide-react'
import { type FC, memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import type { UnifiedVariable } from '~/components/workflow/types'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import type {
  HumanConfirmationNodeData,
  HumanConfirmationNode as HumanConfirmationNodeType,
} from './types'

/**
 * Human Confirmation node component
 * Displays a node with 3 output handles for approved, denied, and timeout paths
 */
export const HumanConfirmationNode: FC<HumanConfirmationNodeType> = memo((props) => {
  const { data, id, selected } = props

  /**
   * Get display text for assignees configuration
   */
  const getAssigneeDisplay = (assignees: HumanConfirmationNodeData['assignees']) => {
    const userCount = assignees?.userIds?.length || 0
    const groupCount = assignees?.groups?.length || 0

    const parts = []
    if (userCount > 0) parts.push(`${userCount} user${userCount > 1 ? 's' : ''}`)
    if (groupCount > 0) parts.push(`${groupCount} group${groupCount > 1 ? 's' : ''}`)

    return parts.length > 0 ? parts.join(', ') : 'No assignees'
  }

  /**
   * Format timeout display text
   */
  const formatTimeout = (timeout: { duration: number | UnifiedVariable; unit: string }) => {
    if (!timeout) return 'Not set'
    if (typeof timeout.duration !== 'number') return 'Variable'
    return `${timeout.duration} ${timeout.unit}`
  }

  // Calculate total source handles based on timeout configuration
  const hasTimeout = data.timeout && data.timeout.enabled
  const totalSourceHandles = hasTimeout ? 3 : 2

  // Augment data with handle count for collapsed height calculation
  const augmentedData = { ...data, _sourceHandleCount: totalSourceHandles }

  return (
    <BaseNode {...props} data={augmentedData}>
      <NodeTargetHandle id={id} data={{ ...augmentedData, selected }} handleId='target' />

      <div className='relative px-3 pb-2 space-y-1'>
        {data.assignees && (
          <div className='relative flex items-center justify-between h-6 rounded-md bg-muted px-2'>
            <div className='flex items-center gap-1'>
              <Users className='size-3' />

              <div className='whitespace-pre-line'>
                <div className='text-sm font-medium'>{getAssigneeDisplay(data.assignees)}</div>
              </div>
            </div>
            <div className='flex gap-1'>
              {data.notification_methods?.in_app && (
                <Bell className='h-3 w-3 text-muted-foreground' />
              )}
              {data.notification_methods?.email && (
                <Mail className='h-3 w-3 text-muted-foreground' />
              )}
            </div>
          </div>
        )}

        {/* Output handles */}
        {/* Approved handle */}
        <div className='relative flex items-center justify-end h-6 rounded-md bg-good-50'>
          <div className='text-xs rounded-md px-1 font-semibold uppercase bg-good-100 text-good-500 whitespace-pre-line'>
            Approved
          </div>
          <NodeSourceHandle
            id={id}
            data={{ ...augmentedData, selected }}
            handleId='approved'
            handleClassName='!top-1/2 !-right-[12px]'
            handleIndex={0}
            handleTotal={totalSourceHandles}
          />
        </div>
        <div className='relative flex items-center justify-end p-1 bg-bad-50 rounded-md'>
          <div className='text-xs rounded-md px-1 font-semibold uppercase bg-bad-100 text-bad-500 whitespace-pre-line'>
            Denied
          </div>
          <NodeSourceHandle
            id={id}
            data={{ ...augmentedData, selected }}
            handleId='denied'
            handleClassName='!top-1/2 !-right-[12px]'
            handleIndex={1}
            handleTotal={totalSourceHandles}
          />
        </div>

        {/* Timeout handle */}
        {hasTimeout && (
          <div className='relative flex items-center justify-between p-1 bg-accent-100 rounded-md'>
            <span className='flex items-center gap-1'>
              <Clock className='size-3 text-accent-500' />
              <span className='text-xs text-accent-400'>{formatTimeout(data.timeout!)}</span>
            </span>
            <div className='text-xs rounded-md px-1 font-semibold uppercase bg-accent-100 text-accent-500 whitespace-pre-line'>
              Timeout
            </div>
            <NodeSourceHandle
              id={id}
              data={{ ...augmentedData, selected }}
              handleId='timeout'
              handleClassName='!top-1/2 !-right-[12px]'
              handleIndex={2}
              handleTotal={totalSourceHandles}
            />
          </div>
        )}
      </div>
    </BaseNode>
  )
})

HumanConfirmationNode.displayName = 'HumanConfirmationNode'
