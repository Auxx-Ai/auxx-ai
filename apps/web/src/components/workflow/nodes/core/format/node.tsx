// apps/web/src/components/workflow/nodes/core/format/node.tsx

'use client'

import { getOperationGroup, OPERATION_METADATA } from '@auxx/lib/workflow-engine/constants'
import type { FC } from 'react'
import { memo } from 'react'
import { NodeSourceHandle, NodeTargetHandle } from '../../../ui/node-handle'
import { BaseNode } from '../../shared/base/base-node'
import type { FormatNode as FormatNodeType } from './types'

/**
 * Format node visual component
 */
export const FormatNode: FC<FormatNodeType> = memo((props) => {
  const { data, id, selected } = props
  const meta = OPERATION_METADATA[data.operation]
  const group = getOperationGroup(data.operation)

  return (
    <BaseNode id={id} data={data} selected={selected} width={244} height='auto'>
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId='target' />
      <div className='px-3 pb-2'>
        <div className='h-6 relative flex items-center justify-between rounded-md bg-muted'>
          <div className='text-xs text-muted-foreground px-2'>
            {group?.label}: {meta?.label ?? 'Unknown'}
          </div>
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

FormatNode.displayName = 'FormatNode'
