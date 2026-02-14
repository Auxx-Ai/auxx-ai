// apps/web/src/components/workflow/nodes/core/date-time/node.tsx

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import type { DateTimeNode as DateTimeNodeType } from './types'

/**
 * Date Time node visual component
 */
export const DateTimeNode = memo<DateTimeNodeType>(({ id, data, selected }) => {
  // Generate description based on operation
  const getOperationDescription = () => {
    switch (data.operation) {
      case 'add_subtract':
        return data.addSubtract
          ? `${data.addSubtract.action === 'add' ? 'Add' : 'Subtract'} ${data.addSubtract.duration} ${data.addSubtract.unit}`
          : 'Add/Subtract'
      case 'format':
        return data.format?.type === 'custom' && data.format.customFormat
          ? `Format: ${data.format.customFormat}`
          : `Format: ${data.format?.type || 'date'}`
      case 'time_between':
        return `Time between in ${data.timeBetween?.unit || 'days'}`
      case 'round':
        return `Round ${data.round?.direction || 'nearest'} ${data.round?.unit || 'day'}`
      default:
        return 'Date operation'
    }
  }

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='px-3 pb-2'>
        <div className='h-6 relative flex items-center justify-between rounded-md bg-muted'>
          <div className='text-xs text-muted-foreground px-2'>{getOperationDescription()}</div>
        </div>
      </div>

      <NodeSourceHandle
        id={id}
        data={{ ...data, selected }}
        handleClassName='!bottom-5'
        handleId='source'
      />
    </BaseNode>
  )
})

DateTimeNode.displayName = 'DateTimeNode'
