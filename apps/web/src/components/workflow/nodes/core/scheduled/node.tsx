// apps/web/src/components/workflow/nodes/core/scheduled-trigger/node.tsx

import { type FC, memo } from 'react'
import type { NodeProps } from '~/components/workflow/types/node-base'
import { NodeSourceHandle } from '~/components/workflow/ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { ScheduledTriggerNodeData } from './types'
import { getScheduleDescription } from './utils'

/**
 * Node type for scheduled trigger
 */
export type ScheduledTriggerNode = NodeProps<ScheduledTriggerNodeData>

/**
 * Scheduled trigger node component
 */
export const ScheduledTriggerNode: FC<ScheduledTriggerNode> = memo((props) => {
  const { id, data, selected } = props

  // Generate schedule summary for display
  const scheduleDescription = data.config ? getScheduleDescription(data.config) : 'Not configured'

  // Create display data that includes schedule info
  const displayData = {
    ...data,
    desc: data.config ? scheduleDescription : 'Configure your schedule',
  }

  return (
    <BaseNode id={id} data={displayData} selected={selected}>
      <NodeSourceHandle id={id} data={{ ...displayData, selected }} handleId='source' />
    </BaseNode>
  )
})

ScheduledTriggerNode.displayName = 'ScheduledTriggerNode'
